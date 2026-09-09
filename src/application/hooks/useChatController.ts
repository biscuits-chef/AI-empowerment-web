import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { QaGateway } from '../ports/qaGateway';
import type {
  AnswerSnapshot,
  AnswerStreamEvent,
  AgentType,
  DisplayMessage,
  Feedback,
  Message,
  TemporaryFile,
  TemporaryFileUsage,
} from '../../domain/models';
import { isTerminalStatus } from '../../domain/models';
import { ApiError, ReplayGapError } from '../../infrastructure/http/httpQaGateway';
import { DEFAULT_AGENT_TYPE, findAgent } from '../../infrastructure/config/agentCatalog';
import { chatReducer, initialChatState } from '../state/chatState';
import { conversationTitleFromFirstQuestion } from '../conversationTitle';

const stageByEvent: Partial<Record<AnswerStreamEvent['type'], string>> = {
  workflow_plan_selected: '已选择双通道执行流程',
  intent_recognition_started: '正在识别问题意图',
  intent_recognized: '问题意图已识别',
  retrieval_started: '正在查询知识库',
  knowledge_retrieval_completed: '知识库查询已完成',
  business_query_started: '正在查询业务数据库',
  business_query_completed: '业务数据库查询已完成',
  evidence_reconciliation_started: '正在核对双通道数据',
  evidence_assessed: '双通道数据核验已完成',
  generation_started: '正在组织回答',
  generation_completed: '回答内容已生成，正在保存',
  cancellation_requested: '正在停止回答',
};

/** 一期单个附件的前端预校验字节上限。 */
const MAXIMUM_FILE_BYTES = 1024 * 1024;
/** 一期允许的附件扩展名。 */
const SUPPORTED_FILE_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'xlsx',
  'txt',
  'md',
  'jpg',
  'jpeg',
  'png',
]);

/**
 * 在上传前执行大小、类型和空文件预校验；服务端仍是最终校验依据。
 *
 * @param file 浏览器选择的文件。
 * @returns 校验通过时为空，否则返回用户提示。
 */
const validateLocalFile = (file: File): string | null => {
  if (file.size === 0) return `${file.name} 是空文件，无法上传`;
  if (file.size > MAXIMUM_FILE_BYTES) return `${file.name} 超过 1 MiB 限制`;
  const separator = file.name.lastIndexOf('.');
  const extension = separator < 0 ? '' : file.name.slice(separator + 1).toLowerCase();
  if (!SUPPORTED_FILE_EXTENSIONS.has(extension)) {
    return `${file.name} 的文件类型暂不支持`;
  }
  return null;
};

/**
 * 将持久化快照转换为页面消息。
 *
 * @param snapshot 回答持久化快照。
 *
 * @returns 函数处理结果。
 */
const messageFromSnapshot = (snapshot: AnswerSnapshot): DisplayMessage => ({
  id: snapshot.answerId,
  answerId: snapshot.answerId,
  role: 'ASSISTANT',
  content: snapshot.content ?? '',
  createdAt: snapshot.createdAt,
  answerStatus: snapshot.status,
  traceId: snapshot.traceId,
  errorMessage: snapshot.errorCode ?? snapshot.cancelErrorCode ?? undefined,
});

/**
 * 将历史接口消息恢复为页面状态，并从持久化产物恢复引用和复核提示。
 *
 * @param message 后端历史消息。
 * @returns 可直接展示的消息状态。
 */
const displayMessageFromHistory = (message: Message): DisplayMessage => {
  const executionEvents = message.executionEvents ?? [];
  const restoredCitations = (message.artifacts ?? [])
    .filter(({ type }) => type === 'CITATION')
    .map(({ reference }) => reference);
  return {
    ...message,
    answerStatus:
      message.answerStatus ??
      (message.role === 'ASSISTANT' && message.answerId ? 'COMPLETED' : undefined),
    executionEvents,
    citations: restoredCitations,
    needsManualReview: executionEvents.some(({ type }) => type === 'manual_review_required'),
  };
};

/**
 * 查找某条回答前最近的用户问题，作为重新发起问答的原始输入。
 *
 * @param messages 当前会话按时间排列的消息。
 * @param answerId 被重新发起的回答 ID。
 * @returns 找到的原始用户问题；不存在时返回 undefined。
 */
const findOriginalQuestion = (
  messages: DisplayMessage[],
  answerId: string,
): DisplayMessage | undefined => {
  const answerIndex = messages.findIndex((message) => message.answerId === answerId);
  for (let index = answerIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.role === 'USER') return candidate;
  }
  return undefined;
};

/**
 * 将未知异常转换为安全的用户提示。
 *
 * @param error 异常对象。
 *
 * @returns 函数处理结果。
 */
const errorMessage = (error: unknown): string =>
  error instanceof ApiError ? error.message : '操作未完成，请稍后重试';

/**
 * 集中编排会话操作、回答流订阅、断线恢复和界面状态，组件只负责展示与交互。
 *
 * @param gateway 问答后端访问端口。
 *
 * @returns 函数处理结果。
 */
export const useChatController = (gateway: QaGateway) => {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const streams = useRef(new Map<string, AbortController>());
  const selectionSequence = useRef(0);
  const [attachments, setAttachments] = useState<TemporaryFile[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [activeAgentType, setActiveAgentType] = useState<AgentType>(DEFAULT_AGENT_TYPE);

  useEffect(() => {
    const activeStreams = streams.current;
    void gateway
      .listConversations()
      .then((page) => dispatch({ type: 'loaded', page }))
      .catch((error: unknown) => dispatch({ type: 'error', message: errorMessage(error) }));
    return () => {
      activeStreams.forEach((controller) => controller.abort());
      activeStreams.clear();
    };
  }, [gateway]);

  /**
   * 使用服务端下一页游标继续加载会话，重复触发只执行一次请求。
   *
   * @returns 下一页加载完成后的异步结果。
   */
  const loadMoreConversations = useCallback(async (): Promise<void> => {
    if (
      state.loadingMoreConversations ||
      !state.hasMoreConversations ||
      !state.nextConversationCursor
    ) {
      return;
    }
    dispatch({ type: 'loadingMoreConversations', value: true });
    try {
      const page = await gateway.listConversations(state.nextConversationCursor);
      dispatch({ type: 'moreConversationsLoaded', page });
    } catch (error) {
      dispatch({ type: 'error', message: errorMessage(error) });
      dispatch({ type: 'loadingMoreConversations', value: false });
    }
  }, [
    gateway,
    state.hasMoreConversations,
    state.loadingMoreConversations,
    state.nextConversationCursor,
  ]);

  /**
   * 将回答事件归并到当前消息状态。
   *
   * @param answerId 回答 ID。
   *
   * @param event 回答流事件。
   */
  const applyStreamEvent = useCallback((answerId: string, event: AnswerStreamEvent): void => {
    if (event.type !== 'delta' && event.type !== 'metadata') {
      dispatch({
        type: 'executionEvent',
        id: answerId,
        event: {
          sequence: event.id,
          type: event.type,
          value: event.value,
          occurredAt: event.occurredAt ?? new Date().toISOString(),
        },
      });
    }
    const stageLabel = stageByEvent[event.type];
    if (stageLabel) dispatch({ type: 'messagePatched', id: answerId, patch: { stageLabel } });
    switch (event.type) {
      case 'delta':
        dispatch({ type: 'delta', id: answerId, value: event.value });
        break;
      case 'citation':
        dispatch({ type: 'citation', id: answerId, citation: event.value });
        break;
      case 'manual_review_required':
        dispatch({
          type: 'messagePatched',
          id: answerId,
          patch: { needsManualReview: true, stageLabel: '双通道数据不一致，请人工复核' },
        });
        break;
      case 'clarification_required':
        dispatch({
          type: 'messagePatched',
          id: answerId,
          patch: { answerStatus: 'NEEDS_CLARIFICATION', stageLabel: '请补充或确认查询对象' },
        });
        break;
      case 'generation_started':
        dispatch({ type: 'messagePatched', id: answerId, patch: { answerStatus: 'GENERATING' } });
        break;
      case 'cancellation_requested':
        dispatch({
          type: 'messagePatched',
          id: answerId,
          patch: { answerStatus: 'CANCEL_REQUESTED' },
        });
        break;
      case 'cancelled':
        dispatch({
          type: 'messagePatched',
          id: answerId,
          patch: { answerStatus: 'CANCELLED', stageLabel: '回答已停止' },
        });
        break;
      case 'completed':
        dispatch({
          type: 'messagePatched',
          id: answerId,
          patch: {
            answerStatus:
              event.value === 'clarification_required' ? 'NEEDS_CLARIFICATION' : 'COMPLETED',
            stageLabel: undefined,
          },
        });
        break;
      case 'cancellation_failed':
        dispatch({
          type: 'messagePatched',
          id: answerId,
          patch: {
            answerStatus: 'CANCEL_FAILED',
            stageLabel: undefined,
            errorMessage: event.value || '停止回答失败',
          },
        });
        break;
      case 'error':
        dispatch({
          type: 'messagePatched',
          id: answerId,
          patch: {
            answerStatus: 'FAILED',
            stageLabel: undefined,
            errorMessage: event.value || '回答生成失败',
          },
        });
        break;
      default:
        break;
    }
  }, []);

  /**
   * 持续订阅回答并在连接异常时恢复快照。
   *
   * @param snapshot 回答持久化快照。
   *
   * @returns 函数处理结果。
   */
  const followAnswer = useCallback(
    async (snapshot: AnswerSnapshot): Promise<void> => {
      if (isTerminalStatus(snapshot.status)) return;
      const controller = new AbortController();
      streams.current.set(snapshot.answerId, controller);
      let lastSequence = 0;
      let terminalEventReceived = false;
      let answerErrorReceived = false;
      try {
        for (let attempt = 0; attempt < 3 && !terminalEventReceived; attempt += 1) {
          try {
            await gateway.streamAnswer(snapshot.answerId, {
              signal: controller.signal,
              afterSequence: lastSequence,
              onEvent: (event) => {
                lastSequence = Math.max(lastSequence, event.id);
                terminalEventReceived = [
                  'completed',
                  'cancelled',
                  'error',
                  'cancellation_failed',
                ].includes(event.type);
                answerErrorReceived = event.type === 'error';
                applyStreamEvent(snapshot.answerId, event);
              },
            });
          } catch (error) {
            if (controller.signal.aborted) return;
            if (
              !(error instanceof ReplayGapError) &&
              (!(error instanceof ApiError) || error.status !== 0)
            ) {
              throw error;
            }
          }
          // error 事件无法区分 FAILED 与保留部分内容的 INCOMPLETE，必须读取持久化快照还原真实终态。
          if (terminalEventReceived && !answerErrorReceived) return;
          const restored = await gateway.getAnswer(snapshot.answerId);
          dispatch({
            type: 'messagePatched',
            id: snapshot.answerId,
            patch: messageFromSnapshot(restored),
          });
          if (isTerminalStatus(restored.status)) return;
        }
        throw new ApiError('流式回答连接中断，请稍后重试', 0);
      } catch (error) {
        if (controller.signal.aborted) return;
        dispatch({
          type: 'messagePatched',
          id: snapshot.answerId,
          patch: {
            answerStatus: 'FAILED',
            errorMessage: errorMessage(error),
            stageLabel: undefined,
          },
        });
      } finally {
        streams.current.delete(snapshot.answerId);
        dispatch({ type: 'sending', value: false });
      }
    },
    [applyStreamEvent, gateway],
  );

  /**
   * 选择会话并从服务端加载历史消息。
   *
   * @param chatId 会话 ID。
   *
   * @returns 函数处理结果。
   */
  const selectChat = useCallback(
    async (chatId: string): Promise<void> => {
      const requestSequence = selectionSequence.current + 1;
      selectionSequence.current = requestSequence;
      setAttachments([]);
      dispatch({ type: 'selecting', chatId });
      try {
        const messages = await gateway.listMessages(chatId);
        // 用户快速切换会话时，只允许最后一次选择更新消息区，避免旧响应覆盖当前会话。
        if (selectionSequence.current !== requestSequence) return;
        dispatch({
          type: 'messagesLoaded',
          messages: messages.map(displayMessageFromHistory),
        });
        const activeAnswer = [...messages]
          .reverse()
          .find(
            (message) =>
              message.role === 'ASSISTANT' &&
              message.answerId &&
              !isTerminalStatus(message.answerStatus ?? undefined),
          );
        if (activeAnswer?.answerId) {
          dispatch({ type: 'sending', value: true });
          const snapshot = await gateway.getAnswer(activeAnswer.answerId);
          if (selectionSequence.current !== requestSequence) return;
          dispatch({
            type: 'messagePatched',
            id: activeAnswer.id,
            patch: messageFromSnapshot(snapshot),
          });
          void followAnswer(snapshot);
        }
      } catch (error) {
        if (selectionSequence.current !== requestSequence) return;
        dispatch({ type: 'error', message: errorMessage(error) });
      }
    },
    [followAnswer, gateway],
  );

  /**
   * 清空当前会话选择以准备新问题。
   */
  const newChat = useCallback((): void => {
    selectionSequence.current += 1;
    setAttachments([]);
    dispatch({ type: 'selecting', chatId: null });
  }, []);

  /**
   * 上传用户选择的临时文件；新聊天会先建立会话归属再上传。
   *
   * @param files 浏览器选择的文件列表。
   *
   * @returns 函数处理结果。
   */
  const uploadFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0 || uploadingFiles) return;
      if (attachments.length + files.length > 5) {
        dispatch({ type: 'error', message: '单个问题最多上传 5 个附件' });
        return;
      }
      const invalidFile = files.map(validateLocalFile).find((message) => message !== null);
      if (invalidFile) {
        dispatch({ type: 'error', message: invalidFile });
        return;
      }
      setUploadingFiles(true);
      dispatch({ type: 'error', message: null });
      try {
        let chatId = state.activeChatId;
        if (!chatId) {
          const conversation = await gateway.createConversation('新聊天');
          chatId = conversation.id;
          dispatch({ type: 'conversationAdded', conversation });
          dispatch({ type: 'selecting', chatId });
          dispatch({ type: 'messagesLoaded', messages: [] });
        }
        for (const file of files) {
          const uploaded = await gateway.uploadFile(chatId, file, 'AUTO');
          // 批量上传中后续文件失败时，保留并展示此前已成功上传的文件，避免产生不可见孤儿附件。
          setAttachments((current) => [...current, uploaded]);
        }
      } catch (error) {
        dispatch({ type: 'error', message: errorMessage(error) });
      } finally {
        setUploadingFiles(false);
      }
    },
    [attachments.length, gateway, state.activeChatId, uploadingFiles],
  );

  /**
   * 修改附件在本次问题中的使用角色，不改变已上传对象内容。
   *
   * @param fileId 文件 ID。
   * @param usage 新使用角色。
   */
  const changeAttachmentUsage = useCallback((fileId: string, usage: TemporaryFileUsage): void => {
    setAttachments((current) =>
      current.map((file) => (file.id === fileId ? { ...file, usage } : file)),
    );
  }, []);

  /**
   * 删除尚未随当前问题提交的附件。
   *
   * @param fileId 文件 ID。
   *
   * @returns 函数处理结果。
   */
  const removeAttachment = useCallback(
    async (fileId: string): Promise<void> => {
      const chatId = state.activeChatId;
      if (!chatId) return;
      try {
        await gateway.deleteFile(chatId, fileId);
        setAttachments((current) => current.filter((file) => file.id !== fileId));
      } catch (error) {
        dispatch({ type: 'error', message: errorMessage(error) });
      }
    },
    [gateway, state.activeChatId],
  );

  /**
   * 创建必要会话并提交问题和订阅回答。
   *
   * @param question 用户问题。
   *
   * @returns 函数处理结果。
   */
  const sendQuestion = useCallback(
    async (question: string): Promise<void> => {
      const cleanQuestion = question.trim();
      if (!cleanQuestion || state.sending) return;
      if (attachments.some((file) => file.status !== 'READY')) {
        dispatch({ type: 'error', message: '附件仍在处理，请等待全部文件就绪后再发送' });
        return;
      }
      dispatch({ type: 'sending', value: true });
      dispatch({ type: 'error', message: null });
      try {
        const submittedAttachments = attachments.map((file) => ({
          fileId: file.id,
          name: file.name,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          usage: file.usage,
          status: file.status,
        }));
        let chatId = state.activeChatId;
        let conversationForActivityUpdate = state.conversations.find(({ id }) => id === chatId);
        const defaultTitle = conversationTitleFromFirstQuestion(cleanQuestion);
        if (!chatId) {
          const conversation = await gateway.createConversation(defaultTitle);
          chatId = conversation.id;
          conversationForActivityUpdate = conversation;
          dispatch({ type: 'conversationAdded', conversation });
          dispatch({ type: 'selecting', chatId });
          // 新建会话没有历史消息可等待，立即结束选择加载态后再追加本次用户消息。
          dispatch({ type: 'messagesLoaded', messages: [] });
        } else {
          const placeholderConversation = state.conversations.find(
            ({ id, title }) => id === chatId && title === '新聊天',
          );
          if (placeholderConversation && state.messages.length === 0) {
            const renamedConversation = await gateway.renameConversation(chatId, defaultTitle);
            conversationForActivityUpdate = renamedConversation;
            dispatch({ type: 'conversationUpdated', conversation: renamedConversation });
          }
        }
        dispatch({
          type: 'messageAdded',
          message: {
            id: crypto.randomUUID(),
            role: 'USER',
            content: cleanQuestion,
            createdAt: new Date().toISOString(),
            attachments: submittedAttachments,
          },
        });
        const snapshot = await gateway.submitQuestion(
          chatId,
          cleanQuestion,
          activeAgentType,
          submittedAttachments.map((file) => ({ fileId: file.fileId, usage: file.usage })),
        );
        if (conversationForActivityUpdate) {
          dispatch({
            type: 'conversationUpdated',
            conversation: { ...conversationForActivityUpdate, updatedAt: snapshot.createdAt },
          });
        }
        setAttachments([]);
        dispatch({ type: 'messageAdded', message: messageFromSnapshot(snapshot) });
        await followAnswer(snapshot);
      } catch (error) {
        dispatch({ type: 'error', message: errorMessage(error) });
      }
    },
    [
      activeAgentType,
      attachments,
      followAnswer,
      gateway,
      state.activeChatId,
      state.conversations,
      state.messages.length,
      state.sending,
    ],
  );

  /**
   * 切换当前提问使用的 Agent；仅允许选择前端目录中已开放的能力。
   *
   * @param agentType 用户选择的 Agent 类型。
   */
  const selectAgent = useCallback((agentType: AgentType): void => {
    const agent = findAgent(agentType);
    if (!agent?.available) return;
    setActiveAgentType(agentType);
  }, []);

  /**
   * 调用停止接口并等待服务端状态收敛。
   *
   * @param answerId 回答 ID。
   *
   * @returns 函数处理结果。
   */
  const stopAnswer = useCallback(
    async (answerId: string): Promise<void> => {
      dispatch({ type: 'messagePatched', id: answerId, patch: { stageLabel: '正在停止回答' } });
      try {
        const snapshot = await gateway.cancelAnswer(answerId);
        dispatch({
          type: 'messagePatched',
          id: answerId,
          patch: { answerStatus: snapshot.status, stageLabel: '正在停止回答' },
        });
      } catch (error) {
        dispatch({
          type: 'messagePatched',
          id: answerId,
          patch: { errorMessage: errorMessage(error), stageLabel: undefined },
        });
      }
    },
    [gateway],
  );

  /**
   * 把原问题作为新的用户问答轮次重新发起，并保留旧问题与旧答案。
   *
   * @param answerId 回答 ID。
   *
   * @returns 函数处理结果。
   */
  const regenerate = useCallback(
    async (answerId: string): Promise<void> => {
      if (state.sending) return;
      const originalQuestion = findOriginalQuestion(state.messages, answerId);
      if (!originalQuestion) {
        dispatch({ type: 'error', message: '未找到原问题，无法重新发起问答' });
        return;
      }
      dispatch({ type: 'sending', value: true });
      dispatch({ type: 'error', message: null });
      try {
        const snapshot = await gateway.regenerateAnswer(answerId);
        dispatch({
          type: 'messageAdded',
          message: {
            id: snapshot.questionId,
            role: 'USER',
            content: originalQuestion.content,
            createdAt: snapshot.createdAt,
            attachments: originalQuestion.attachments?.map((attachment) => ({ ...attachment })),
          },
        });
        const currentConversation = state.conversations.find(({ id }) => id === state.activeChatId);
        if (currentConversation) {
          dispatch({
            type: 'conversationUpdated',
            conversation: { ...currentConversation, updatedAt: snapshot.createdAt },
          });
        }
        dispatch({ type: 'messageAdded', message: messageFromSnapshot(snapshot) });
        await followAnswer(snapshot);
      } catch (error) {
        dispatch({ type: 'error', message: errorMessage(error) });
        dispatch({ type: 'sending', value: false });
      }
    },
    [followAnswer, gateway, state.activeChatId, state.conversations, state.messages, state.sending],
  );

  /**
   * 提交用户反馈并更新显示状态。
   *
   * @param answerId 回答 ID。
   *
   * @param value 输入值。
   *
   * @returns 函数处理结果。
   */
  const feedback = useCallback(
    async (answerId: string, value: Feedback): Promise<void> => {
      dispatch({ type: 'feedback', id: answerId, feedback: value });
      try {
        await gateway.recordFeedback(answerId, value);
      } catch (error) {
        dispatch({ type: 'error', message: errorMessage(error) });
      }
    },
    [gateway],
  );

  /**
   * 校验名称并请求后端修改会话。
   *
   * @param chatId 会话 ID。
   *
   * @param title 会话名称。
   *
   * @returns 函数处理结果。
   */
  const renameChat = useCallback(
    async (chatId: string, title: string): Promise<void> => {
      try {
        const conversation = await gateway.renameConversation(chatId, title.trim().slice(0, 100));
        dispatch({ type: 'conversationUpdated', conversation });
      } catch (error) {
        dispatch({ type: 'error', message: errorMessage(error) });
      }
    },
    [gateway],
  );

  /**
   * 删除会话并更新当前页面状态。
   *
   * @param chatId 会话 ID。
   *
   * @returns 函数处理结果。
   */
  const deleteChat = useCallback(
    async (chatId: string): Promise<void> => {
      try {
        await gateway.deleteConversation(chatId);
        dispatch({ type: 'conversationDeleted', chatId });
      } catch (error) {
        dispatch({ type: 'error', message: errorMessage(error) });
      }
    },
    [gateway],
  );

  const activeConversation = useMemo(
    () => state.conversations.find(({ id }) => id === state.activeChatId),
    [state.activeChatId, state.conversations],
  );

  return {
    state,
    activeAgentType,
    attachments,
    uploadingFiles,
    activeConversation,
    loadMoreConversations,
    selectChat,
    newChat,
    selectAgent,
    sendQuestion,
    uploadFiles,
    removeAttachment,
    changeAttachmentUsage,
    stopAnswer,
    regenerate,
    feedback,
    renameChat,
    deleteChat,
    clearError: () => dispatch({ type: 'error', message: null }),
  };
};

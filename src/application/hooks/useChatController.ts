import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { QaGateway } from '../ports/qaGateway';
import type {
  AnswerSnapshot,
  AnswerStreamEvent,
  AgentType,
  DisplayMessage,
  Feedback,
  Message,
} from '../../domain/models';
import { isTerminalStatus } from '../../domain/models';
import { ApiError, ReplayGapError } from '../../infrastructure/http/httpQaGateway';
import { DEFAULT_AGENT_TYPE, findAgent } from '../../infrastructure/config/agentCatalog';
import { chatReducer, initialChatState } from '../state/chatState';

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

/**
 * 等待确认的提问幂等信息，用于响应丢失后的安全重试。
 */
type PendingSubmission = {
  /** 由会话、首次选择的 Agent 和问题共同组成的稳定请求指纹。 */
  fingerprint: string;
  /** 同一逻辑提问失败重试期间复用的幂等键。 */
  idempotencyKey: string;
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
  const pendingSubmission = useRef<PendingSubmission | null>(null);
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
    setActiveAgentType(DEFAULT_AGENT_TYPE);
    dispatch({ type: 'selecting', chatId: null });
  }, []);

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
      dispatch({ type: 'sending', value: true });
      dispatch({ type: 'error', message: null });
      try {
        const requestedChatId = state.activeChatId;
        const requestedAgentType = requestedChatId === null ? activeAgentType : null;
        const fingerprint = JSON.stringify([requestedChatId, requestedAgentType, cleanQuestion]);
        const idempotencyKey =
          pendingSubmission.current?.fingerprint === fingerprint
            ? pendingSubmission.current.idempotencyKey
            : crypto.randomUUID();
        pendingSubmission.current = { fingerprint, idempotencyKey };
        const submission = await gateway.submitQuestion(
          requestedChatId,
          cleanQuestion,
          requestedAgentType,
          idempotencyKey,
        );
        pendingSubmission.current = null;
        const chatId = submission.conversation.id;
        if (submission.conversationCreated) {
          dispatch({ type: 'conversationAdded', conversation: submission.conversation });
          dispatch({ type: 'selecting', chatId });
          // 新建会话没有历史消息可等待，立即结束选择加载态后再追加本次用户消息。
          dispatch({ type: 'messagesLoaded', messages: [] });
        } else {
          dispatch({ type: 'conversationUpdated', conversation: submission.conversation });
        }
        dispatch({
          type: 'messageAdded',
          message: {
            id: crypto.randomUUID(),
            role: 'USER',
            content: cleanQuestion,
            createdAt: new Date().toISOString(),
          },
        });
        const snapshot = submission.answer;
        dispatch({
          type: 'conversationUpdated',
          conversation: { ...submission.conversation, updatedAt: snapshot.createdAt },
        });
        dispatch({ type: 'messageAdded', message: messageFromSnapshot(snapshot) });
        await followAnswer(snapshot);
      } catch (error) {
        dispatch({ type: 'error', message: errorMessage(error) });
      }
    },
    [activeAgentType, followAnswer, gateway, state.activeChatId, state.sending],
  );

  /**
   * 切换新建会话使用的 Agent；已有会话中不允许修改。
   *
   * @param agentType 用户选择的 Agent 类型。
   */
  const selectAgent = useCallback(
    (agentType: AgentType): void => {
      if (state.activeChatId !== null) return;
      const agent = findAgent(agentType);
      if (!agent?.available) return;
      setActiveAgentType(agentType);
    },
    [state.activeChatId],
  );

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
    activeConversation,
    loadMoreConversations,
    selectChat,
    newChat,
    selectAgent,
    sendQuestion,
    stopAnswer,
    regenerate,
    feedback,
    renameChat,
    deleteChat,
    clearError: () => dispatch({ type: 'error', message: null }),
  };
};

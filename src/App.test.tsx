import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { QaGateway, StreamOptions } from './application/ports/qaGateway';
import type { AnswerSnapshot, Message } from './domain/models';
import type { RuntimeConfig } from './infrastructure/config/runtimeConfig';
import { ApiError } from './infrastructure/http/httpQaGateway';

const config: RuntimeConfig = {
  environment: 'test',
  apiBaseUrl: '/api/v1',
  requestTimeoutMillis: 1000,
  streamIdleTimeoutMillis: 1000,
  maxQuestionCharacters: 4000,
};
const snapshot: AnswerSnapshot = {
  answerId: 'answer-1',
  questionId: 'question-1',
  traceId: 'trace-1',
  regeneratedFromAnswerId: null,
  status: 'PENDING',
  content: '',
  errorCode: null,
  cancelReason: null,
  cancelledStage: null,
  cancelErrorCode: null,
  streamPath: '/api/v1/answers/answer-1/events',
  createdAt: '2026-01-01',
  completedAt: null,
  cancelRequestedAt: null,
  cancelledAt: null,
};

/**
 * 可由测试显式完成的异步结果。
 */
type DeferredResult<T> = {
  /**
   * 等待测试完成的异步结果。
   */
  promise: Promise<T>;
  /**
   * 完成异步结果的回调。
   *
   * @param value 返回值。
   */
  resolve: (value: T) => void;
};

/**
 * 创建由测试步骤显式控制完成顺序的异步结果。
 *
 * @returns 可控制完成时机的异步结果。
 */
const deferredMessages = (): DeferredResult<Message[]> => {
  /**
   * 在真实完成回调绑定前安全接收测试值。
   *
   * @param value 测试消息列表。
   *
   * @returns 无返回值。
   */
  let complete: (value: Message[]) => void = () => undefined;
  const promise = new Promise<Message[]>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: complete };
};

/**
 * 创建可按测试场景覆盖行为的问答访问端口替身。
 *
 * @returns 函数处理结果。
 */
const gateway = (): QaGateway => ({
  listConversations: vi.fn().mockResolvedValue({
    items: [],
    nextCursor: null,
    hasMore: false,
  }),
  renameConversation: vi.fn().mockImplementation((chatId: string, title: string) =>
    Promise.resolve({
      id: chatId,
      title,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }),
  ),
  deleteConversation: vi.fn(),
  listMessages: vi.fn().mockResolvedValue([]),
  submitQuestion: vi.fn().mockImplementation((chatId: string | null, question: string) =>
    Promise.resolve({
      conversation: {
        id: chatId ?? 'chat-1',
        title: question,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      conversationCreated: chatId === null,
      answer: snapshot,
    }),
  ),
  regenerateAnswer: vi.fn().mockResolvedValue(snapshot),
  cancelAnswer: vi.fn().mockResolvedValue({ ...snapshot, status: 'CANCEL_REQUESTED' }),
  getAnswer: vi.fn().mockResolvedValue(snapshot),
  recordFeedback: vi.fn().mockResolvedValue(undefined),
  streamAnswer: vi.fn().mockImplementation((_answerId: string, options: StreamOptions) => {
    options.onEvent({ id: 1, type: 'retrieval_started', value: 'STARTED' });
    options.onEvent({ id: 2, type: 'delta', value: '产品经理为张经理。' });
    options.onEvent({ id: 3, type: 'citation', value: '产品档案' });
    options.onEvent({ id: 4, type: 'completed', value: 'stop' });
    return Promise.resolve();
  }),
});

describe('App', () => {
  it('默认并列展示左侧会话列表并支持折叠与恢复', async () => {
    const user = userEvent.setup();
    render(<App gateway={gateway()} config={config} />);

    await screen.findByText('今天想完成什么？');
    expect(screen.getByRole('complementary', { name: '聊天记录' })).toHaveClass(
      'sidebar--persistent',
    );
    expect(document.querySelector('.main-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭侧边栏' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开侧边栏' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '关闭侧边栏' }));
    expect(screen.queryByRole('complementary', { name: '聊天记录' })).not.toBeInTheDocument();
    expect(document.querySelector('.main-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开侧边栏' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '打开侧边栏' }));
    expect(screen.getByRole('complementary', { name: '聊天记录' })).toHaveClass(
      'sidebar--persistent',
    );
    expect(screen.getByRole('button', { name: '关闭侧边栏' })).toBeInTheDocument();
  });

  it('完成从空白页到流式答案的主流程', async () => {
    const qaGateway = gateway();
    const user = userEvent.setup();
    render(<App gateway={qaGateway} config={config} />);
    expect(await screen.findByText('今天想完成什么？')).toBeInTheDocument();
    expect(screen.getByLabelText('选择问答功能，当前：智能问数')).toBeInTheDocument();
    await user.type(screen.getByLabelText('输入问题'), '产品经理是谁');
    await user.click(screen.getByLabelText('发送问题'));
    expect(await screen.findByText('产品经理为张经理。')).toBeInTheDocument();
    expect(screen.getByText('来源与产物（1）')).toBeInTheDocument();
    expect(screen.queryByLabelText(/选择问答功能/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(qaGateway.submitQuestion).toHaveBeenCalledWith(
        null,
        '产品经理是谁',
        'SMART_DATA',
        expect.any(String),
      ),
    );
  });

  it('一期输入区不展示文件上传入口', async () => {
    render(<App gateway={gateway()} config={config} />);
    await screen.findByText('今天想完成什么？');
    expect(screen.queryByLabelText('上传附件')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('选择附件')).not.toBeInTheDocument();
  });

  it('相同提问在响应失败后重试时复用幂等键', async () => {
    const qaGateway = gateway();
    vi.mocked(qaGateway.submitQuestion).mockRejectedValueOnce(new Error('网络中断'));
    const user = userEvent.setup();
    render(<App gateway={qaGateway} config={config} />);
    await screen.findByText('今天想完成什么？');

    await user.type(screen.getByLabelText('输入问题'), '查询产品经理');
    await user.click(screen.getByLabelText('发送问题'));
    await screen.findByRole('alert');
    await user.type(screen.getByLabelText('输入问题'), '查询产品经理');
    await user.click(screen.getByLabelText('发送问题'));
    await waitFor(() => expect(qaGateway.submitQuestion).toHaveBeenCalledTimes(2));

    const firstKey = vi.mocked(qaGateway.submitQuestion).mock.calls[0]?.[3];
    const retryKey = vi.mocked(qaGateway.submitQuestion).mock.calls[1]?.[3];
    expect(firstKey).toBeTruthy();
    expect(retryKey).toBe(firstKey);
  });

  it('支持快捷问题与主题切换', async () => {
    const user = userEvent.setup();
    render(<App gateway={gateway()} config={config} />);
    await screen.findByText('今天想完成什么？');
    await user.click(screen.getByText('查询某产品最新的费率调整计划'));
    expect(screen.getByLabelText('输入问题')).toHaveValue('查询某产品最新的费率调整计划');
    await user.click(screen.getByLabelText('切换为深色模式'));
    expect(document.querySelector('.app')).toHaveAttribute('data-theme', 'dark');
  });

  it('展示歧义追问并允许用户继续补充查询对象', async () => {
    const qaGateway = gateway();
    vi.mocked(qaGateway.streamAnswer).mockImplementation(
      (_answerId: string, options: StreamOptions) => {
        options.onEvent({ id: 1, type: 'clarification_required', value: 'AMBIGUOUS_ENTITY' });
        options.onEvent({
          id: 2,
          type: 'delta',
          value: '找到多个可能的产品，请回复序号：\n1. 悦享一号\n2. 悦享二号',
        });
        options.onEvent({ id: 3, type: 'completed', value: 'clarification_required' });
        return Promise.resolve();
      },
    );
    const user = userEvent.setup();
    render(<App gateway={qaGateway} config={config} />);

    await screen.findByText('今天想完成什么？');
    await user.type(screen.getByLabelText('输入问题'), '查询这个产品的费率');
    await user.click(screen.getByLabelText('发送问题'));

    expect(await screen.findByText(/找到多个可能的产品/)).toBeInTheDocument();
    expect(screen.queryByLabelText('重新生成回答')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('输入问题'), '第二个');
    await user.click(screen.getByLabelText('发送问题'));
    await waitFor(() => expect(qaGateway.submitQuestion).toHaveBeenCalledTimes(2));
    expect(qaGateway.submitQuestion).toHaveBeenLastCalledWith(
      'chat-1',
      '第二个',
      null,
      expect.any(String),
    );
  });

  it('加载历史答案并支持反馈、重新生成和新聊天', async () => {
    const qaGateway = gateway();
    vi.mocked(qaGateway.regenerateAnswer).mockResolvedValue({
      ...snapshot,
      createdAt: new Date().toISOString(),
    });
    vi.mocked(qaGateway.listConversations).mockResolvedValue({
      items: [
        {
          id: 'chat-1',
          title: '历史聊天',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
    vi.mocked(qaGateway.listMessages).mockResolvedValue([
      {
        id: 'question-old',
        role: 'USER',
        content: '查询附件中的产品',
        createdAt: '2026-01-01',
        attachments: [
          {
            fileId: 'file-old',
            name: '历史产品.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeBytes: 2048,
            usage: 'QUERY_INPUT',
            status: 'DELETE_PENDING',
          },
        ],
      },
      {
        id: 'answer-old',
        answerId: 'answer-old',
        answerStatus: 'COMPLETED',
        role: 'ASSISTANT',
        content: '已保存的历史答案',
        createdAt: '2026-01-01',
        executionEvents: [
          {
            sequence: 1,
            type: 'workflow_plan_selected',
            value: 'DUAL_CHANNEL_QA|1',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 2,
            type: 'intent_recognition_started',
            value: 'STARTED',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 3,
            type: 'intent_recognized',
            value: 'PRODUCT_TRADE_BASIC_INFO|95|1',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 4,
            type: 'retrieval_started',
            value: 'STARTED',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 5,
            type: 'knowledge_retrieval_completed',
            value: '1',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 6,
            type: 'business_query_started',
            value: 'STARTED',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 7,
            type: 'business_query_completed',
            value: '1',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 8,
            type: 'evidence_reconciliation_started',
            value: 'STARTED',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 9,
            type: 'evidence_assessed',
            value: 'CONFLICT|1',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 10,
            type: 'manual_review_required',
            value: 'EVIDENCE_CONFLICT',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 11,
            type: 'generation_started',
            value: 'STARTED',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 12,
            type: 'generation_completed',
            value: 'READY_TO_PERSIST',
            occurredAt: '2026-01-01',
          },
          {
            sequence: 13,
            type: 'completed',
            value: 'stop',
            occurredAt: '2026-01-01',
          },
        ],
        artifacts: [{ type: 'CITATION', reference: '产品档案' }],
      },
    ]);
    const user = userEvent.setup();
    render(<App gateway={qaGateway} config={config} />);
    await user.click(await screen.findByText('历史聊天'));
    expect(screen.getByText('更早')).toBeInTheDocument();
    expect(await screen.findByText('历史产品.xlsx')).toBeInTheDocument();
    expect(screen.getByText('文件已过期')).toBeInTheDocument();
    expect(await screen.findByText('已保存的历史答案')).toBeInTheDocument();
    expect(screen.getByText('5/5 个阶段')).toBeInTheDocument();
    expect(screen.getByText('来源与产物（1）')).toBeInTheDocument();
    expect(screen.getByText('需要人工复核')).toBeInTheDocument();
    await user.click(screen.getByLabelText('喜欢这个回答'));
    expect(qaGateway.recordFeedback).toHaveBeenCalledWith('answer-old', 'LIKE');
    await user.click(screen.getByLabelText('重新生成回答'));
    expect(qaGateway.regenerateAnswer).toHaveBeenCalledWith('answer-old');
    expect(screen.getAllByText('查询附件中的产品')).toHaveLength(2);
    expect(screen.getAllByText('历史产品.xlsx')).toHaveLength(1);
    expect(screen.getByText('今天')).toBeInTheDocument();
    expect(screen.queryByText('更早')).not.toBeInTheDocument();
    await user.click(screen.getByText('新建会话'));
    expect(await screen.findByText('今天想完成什么？')).toBeInTheDocument();
  });

  it('切换会话期间禁用提交并忽略过期的消息响应', async () => {
    const qaGateway = gateway();
    vi.mocked(qaGateway.listConversations).mockResolvedValue({
      items: [
        { id: 'chat-1', title: '较慢会话', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'chat-2', title: '目标会话', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      nextCursor: null,
      hasMore: false,
    });
    const slowMessages = deferredMessages();
    const targetMessages = deferredMessages();
    vi.mocked(qaGateway.listMessages).mockImplementation((chatId) =>
      chatId === 'chat-1' ? slowMessages.promise : targetMessages.promise,
    );
    const user = userEvent.setup();
    render(<App gateway={qaGateway} config={config} />);

    await user.click(await screen.findByText('较慢会话'));
    expect(screen.getByRole('status')).toHaveTextContent('正在加载聊天');
    expect(screen.getByLabelText('输入问题')).toBeDisabled();
    await user.click(screen.getByText('目标会话'));
    targetMessages.resolve([
      {
        id: 'target-message',
        role: 'ASSISTANT',
        content: '目标会话消息',
        createdAt: '2026-01-01',
      },
    ]);
    expect(await screen.findByText('目标会话消息')).toBeInTheDocument();

    slowMessages.resolve([
      {
        id: 'slow-message',
        role: 'ASSISTANT',
        content: '过期会话消息',
        createdAt: '2026-01-01',
      },
    ]);
    await waitFor(() => expect(screen.queryByText('过期会话消息')).not.toBeInTheDocument());
    expect(screen.getByText('目标会话消息')).toBeInTheDocument();
  });

  it('刷新后按后端状态恢复历史追问', async () => {
    const qaGateway = gateway();
    vi.mocked(qaGateway.listConversations).mockResolvedValue({
      items: [
        { id: 'chat-1', title: '待补充聊天', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      nextCursor: null,
      hasMore: false,
    });
    vi.mocked(qaGateway.listMessages).mockResolvedValue([
      {
        id: 'clarification-old',
        answerId: 'clarification-old',
        answerStatus: 'NEEDS_CLARIFICATION',
        role: 'ASSISTANT',
        content: '请确认要查询的产品。',
        createdAt: '2026-01-01',
      },
    ]);
    const user = userEvent.setup();
    render(<App gateway={qaGateway} config={config} />);

    await user.click(await screen.findByText('待补充聊天'));

    expect(await screen.findByText('请确认要查询的产品。')).toBeInTheDocument();
    expect(screen.queryByLabelText('重新生成回答')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('喜欢这个回答')).not.toBeInTheDocument();
  });

  it('执行中会话删除失败时展示固定保护提示', async () => {
    const qaGateway = gateway();
    vi.mocked(qaGateway.listConversations).mockResolvedValue({
      items: [
        { id: 'chat-1', title: '执行中会话', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      nextCursor: null,
      hasMore: false,
    });
    vi.mocked(qaGateway.deleteConversation).mockRejectedValue(
      new ApiError('会话正在执行，请停止后删除', 409),
    );
    const user = userEvent.setup();
    render(<App gateway={qaGateway} config={config} />);

    await user.click(await screen.findByLabelText('管理聊天：执行中会话'));
    await user.click(screen.getByText('删除'));
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('会话正在执行，请停止后删除');
    expect(qaGateway.cancelAnswer).not.toHaveBeenCalled();
    expect(screen.getByText('执行中会话')).toBeInTheDocument();
  });

  it('生成过程中发起服务端停止请求', async () => {
    const qaGateway = gateway();
    vi.mocked(qaGateway.streamAnswer).mockImplementation((_answerId, options) => {
      options.onEvent({ id: 1, type: 'generation_started', value: 'STARTED' });
      return new Promise<void>(() => undefined);
    });
    const user = userEvent.setup();
    render(<App gateway={qaGateway} config={config} />);
    await screen.findByText('今天想完成什么？');
    await user.type(screen.getByLabelText('输入问题'), '停止测试');
    await user.click(screen.getByLabelText('发送问题'));
    await user.click(await screen.findByText('停止生成'));
    expect(qaGateway.cancelAnswer).toHaveBeenCalledWith('answer-1');
  });

  it('服务端停止失败后进入停止失败终态', async () => {
    const qaGateway = gateway();
    vi.mocked(qaGateway.streamAnswer).mockImplementation((_answerId, options) => {
      options.onEvent({ id: 1, type: 'cancellation_failed', value: 'MODEL_STOP_FAILED' });
      return Promise.resolve();
    });
    const user = userEvent.setup();
    render(<App gateway={qaGateway} config={config} />);

    await screen.findByText('今天想完成什么？');
    await user.type(screen.getByLabelText('输入问题'), '停止失败测试');
    await user.click(screen.getByLabelText('发送问题'));

    expect(await screen.findByText('MODEL_STOP_FAILED')).toBeInTheDocument();
    expect(screen.queryByText('停止生成')).not.toBeInTheDocument();
  });

  it('部分回答异常后从快照恢复不完整终态', async () => {
    const qaGateway = gateway();
    vi.mocked(qaGateway.streamAnswer).mockImplementation((_answerId, options) => {
      options.onEvent({ id: 1, type: 'delta', value: '已经生成的部分内容' });
      options.onEvent({ id: 2, type: 'error', value: 'MODEL_STREAM_INTERRUPTED' });
      return Promise.resolve();
    });
    vi.mocked(qaGateway.getAnswer).mockResolvedValue({
      ...snapshot,
      status: 'INCOMPLETE',
      content: '已经生成的部分内容',
      errorCode: 'MODEL_STREAM_INTERRUPTED',
    });
    const user = userEvent.setup();
    render(<App gateway={qaGateway} config={config} />);

    await screen.findByText('今天想完成什么？');
    await user.type(screen.getByLabelText('输入问题'), '部分回答测试');
    await user.click(screen.getByLabelText('发送问题'));

    expect(await screen.findByText('已经生成的部分内容')).toBeInTheDocument();
    expect(qaGateway.getAnswer).toHaveBeenCalledWith('answer-1');
    expect(screen.queryByText('停止生成')).not.toBeInTheDocument();
  });
});

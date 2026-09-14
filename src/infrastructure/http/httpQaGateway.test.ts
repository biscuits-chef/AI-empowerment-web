import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnswerSnapshot, Conversation, Message } from '../../domain/models';
import type { RuntimeConfig } from '../config/runtimeConfig';
import { ApiError, HttpQaGateway, ReplayGapError } from './httpQaGateway';

const config: RuntimeConfig = {
  environment: 'test',
  apiBaseUrl: '/api/v1',
  requestTimeoutMillis: 1000,
  streamIdleTimeoutMillis: 1000,
  maxQuestionCharacters: 4000,
};
const conversation: Conversation = {
  id: 'chat-1',
  title: '测试聊天',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const message: Message = {
  id: 'message-1',
  answerId: null,
  role: 'USER',
  content: '问题',
  createdAt: '2026-01-01',
  attachments: [
    {
      fileId: 'file-1',
      name: '产品.txt',
      contentType: 'text/plain',
      sizeBytes: 6,
      usage: 'QUERY_INPUT',
      status: 'READY',
    },
  ],
};
const answer: AnswerSnapshot = {
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
const submission = {
  conversation,
  conversationCreated: true,
  answer,
};
/**
 * 为接口测试创建指定载荷的 JSON 响应。
 *
 * @param value 输入值。
 *
 * @param status 回答状态。
 *
 * @returns 函数处理结果。
 */
const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => vi.restoreAllMocks());

describe('HttpQaGateway', () => {
  it('按契约调用全部普通接口', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ items: [conversation], nextCursor: 'next-page', hasMore: true }),
      )
      .mockResolvedValueOnce(jsonResponse(conversation))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([message]))
      .mockResolvedValueOnce(jsonResponse(submission, 202))
      .mockResolvedValueOnce(jsonResponse(answer, 202))
      .mockResolvedValueOnce(jsonResponse({ ...answer, status: 'CANCEL_REQUESTED' }, 202))
      .mockResolvedValueOnce(jsonResponse(answer))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const gateway = new HttpQaGateway(config);

    await expect(gateway.listConversations('current-page', 20)).resolves.toEqual({
      items: [conversation],
      nextCursor: 'next-page',
      hasMore: true,
    });
    await expect(gateway.renameConversation('chat-1', '新名称')).resolves.toEqual(conversation);
    await expect(gateway.deleteConversation('chat-1')).resolves.toBeUndefined();
    await expect(gateway.listMessages('chat-1')).resolves.toEqual([message]);
    await expect(
      gateway.submitQuestion(null, '问题', 'SMART_DATA', 'question-key'),
    ).resolves.toEqual(submission);
    await expect(gateway.regenerateAnswer('answer-1')).resolves.toEqual(answer);
    await expect(gateway.cancelAnswer('answer-1')).resolves.toMatchObject({
      status: 'CANCEL_REQUESTED',
    });
    await expect(gateway.getAnswer('answer-1')).resolves.toEqual(answer);
    await expect(gateway.recordFeedback('answer-1', 'LIKE')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['/api/v1/chats?limit=20&cursor=current-page', 'GET'],
      ['/api/v1/chats/chat-1/rename', 'POST'],
      ['/api/v1/chats/chat-1/deletion', 'POST'],
      ['/api/v1/chats/chat-1/messages?limit=100', 'GET'],
      ['/api/v1/questions/submission', 'POST'],
      ['/api/v1/answers/answer-1/regenerations', 'POST'],
      ['/api/v1/answers/answer-1/cancellation', 'POST'],
      ['/api/v1/answers/answer-1', 'GET'],
      ['/api/v1/answers/answer-1/feedback', 'POST'],
    ]);
    fetchMock.mock.calls.forEach(([, init]) => {
      expect(['GET', 'POST']).toContain(init?.method ?? 'GET');
    });
    const requestUrls = fetchMock.mock.calls.map(([url]) => url);
    expect(new Set(requestUrls).size).toBe(requestUrls.length);
    const submit = fetchMock.mock.calls[4];
    expect(submit?.[0]).toBe('/api/v1/questions/submission');
    expect(new Headers(submit?.[1]?.headers).get('Idempotency-Key')).toBe('question-key');
    expect(submit?.[1]?.credentials).toBe('include');
    expect(submit?.[1]?.body).toBe('{"chatId":null,"agentType":"SMART_DATA","question":"问题"}');
  });

  it('已有会话的后续提问不发送 Agent 类型字段', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ...submission, conversationCreated: false }, 202));

    await new HttpQaGateway(config).submitQuestion('chat-1', '继续提问', null, 'follow-up-key');

    const request = fetchMock.mock.calls[0];
    expect(request?.[1]?.body).toBe('{"chatId":"chat-1","question":"继续提问"}');
    expect(new Headers(request?.[1]?.headers).get('Idempotency-Key')).toBe('follow-up-key');
  });

  it.each([
    [401, '登录状态已失效'],
    [403, '没有执行此操作的权限'],
    [429, '当前提问较多'],
    [500, '服务暂时不可用'],
    [400, '字段不合法'],
  ])('把状态码 %s 映射为安全错误', async (status, expected) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ title: '失败', detail: status === 400 ? '字段不合法' : '内部细节' }, status),
    );
    const gateway = new HttpQaGateway(config);
    await expect(gateway.listConversations()).rejects.toMatchObject({
      name: 'ApiError',
      status,
      message: expect.stringContaining(expected) as string,
    });
  });

  it('读取流事件并携带最后事件序号', async () => {
    const body = [
      'id: 3\nevent: delta\ndata: {"value":"第一段"}\n\n',
      'id: 4\nevent: completed\ndata: {"value":"stop"}\n\n',
    ];
    const response = new Response(
      new ReadableStream({
        /**
         * 初始化测试流并将终态 SSE 文本写入读取队列。
         *
         * @param controller 测试可读流的入队和关闭控制器。
         *
         * @returns 函数处理结果。
         */
        start(controller) {
          body.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const events: string[] = [];
    await new HttpQaGateway(config).streamAnswer('answer-1', {
      signal: new AbortController().signal,
      afterSequence: 2,
      onEvent: (event) => events.push(`${event.id}:${event.value}`),
    });
    expect(events).toEqual(['3:第一段', '4:stop']);
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Last-Event-ID')).toBe('2');
  });

  it('明确报告事件重放缺口和缺少响应体', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 409 }));
    const gateway = new HttpQaGateway(config);
    await expect(
      gateway.streamAnswer('answer-1', {
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    ).rejects.toBeInstanceOf(ReplayGapError);

    fetchMock.mockResolvedValue({ ok: true, status: 200, body: null } as Response);
    await expect(
      gateway.streamAnswer('answer-1', {
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

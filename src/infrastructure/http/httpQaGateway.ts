import type { QaGateway, StreamOptions } from '../../application/ports/qaGateway';
import type {
  AnswerSnapshot,
  AgentType,
  Conversation,
  ConversationPage,
  Feedback,
  Message,
  QuestionSubmission,
} from '../../domain/models';
import type { RuntimeConfig } from '../config/runtimeConfig';
import { SseParser } from '../stream/sseParser';

/**
 * 后端安全问题响应字段。
 */
type ProblemDetail = {
  /**
   * 错误响应标题。
   */
  title?: string;
  /**
   * 对外安全错误说明。
   */
  detail?: string;
  /**
   * HTTP 响应状态码。
   */
  status?: number;
  /**
   * 链路追踪 ID。
   */
  traceId?: string;
};

/**
 * 面向前端业务接口的 GET/POST 请求初始化参数。
 */
type FrontendRequestInit = Omit<RequestInit, 'method'> & {
  /**
   * 允许发送的 HTTP 方法；省略时由浏览器使用 GET。
   */
  method?: 'GET' | 'POST';
};

/**
 * 可安全展示给用户的后端调用异常。
 */
export class ApiError extends Error {
  /**
   * 创建包含安全提示、HTTP 状态码和链路标识的接口异常。
   *
   * @param message 可向用户展示的安全错误提示。
   *
   * @param status HTTP 状态码；0 表示网络或超时错误。
   *
   * @param traceId 链路追踪 ID。
   */
  constructor(
    message: string,
    readonly status: number,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 表示请求的 SSE 序号已过期，调用方必须改读回答快照。
 */
export class ReplayGapError extends ApiError {
  /**
   * 创建必须改读服务端快照的事件缺口异常。
   */
  constructor() {
    super('流式事件已过期，需要恢复答案快照', 409);
    this.name = 'ReplayGapError';
  }
}

/**
 * 将后端错误响应转换为安全异常。
 *
 * @param response 后端 HTTP 响应。
 *
 * @returns 函数处理结果。
 */
const problemFrom = async (response: Response): Promise<ApiError> => {
  let problem: ProblemDetail = {};
  try {
    problem = (await response.json()) as ProblemDetail;
  } catch {
    // 非 JSON 错误响应统一转换为安全提示。
  }
  const safeMessage =
    response.status === 401
      ? '登录状态已失效，请重新登录'
      : response.status === 403
        ? '当前账号没有执行此操作的权限'
        : response.status === 429
          ? '当前提问较多，请稍后重试'
          : response.status >= 500
            ? '服务暂时不可用，请稍后重试'
            : (problem.detail ?? problem.title ?? '请求未完成');
  return new ApiError(safeMessage, response.status, problem.traceId);
};

/**
 * 基于同源凭据、幂等键和有界超时实现问答 HTTP/SSE 端口。
 */
export class HttpQaGateway implements QaGateway {
  /**
   * 使用当前环境的运行配置创建问答接口客户端。
   *
   * @param config 前端运行配置。
   */
  constructor(private readonly config: RuntimeConfig) {}

  /**
   * 查询当前用户的会话列表。
   *
   * @param cursor 上一页返回的不透明游标。
   * @param limit 结果数量上限。
   *
   * @returns 函数处理结果。
   */
  listConversations(cursor?: string, limit = 30): Promise<ConversationPage> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return this.request(`/chats?${query.toString()}`);
  }

  /**
   * 修改指定会话名称。
   *
   * @param chatId 要修改的会话 ID。
   *
   * @param title 会话名称。
   *
   * @returns 函数处理结果。
   */
  renameConversation(chatId: string, title: string): Promise<Conversation> {
    return this.request(`/chats/${chatId}/rename`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  }

  /**
   * 删除当前用户的指定会话。
   *
   * @param chatId 会话 ID。
   *
   * @returns 函数处理结果。
   */
  deleteConversation(chatId: string): Promise<void> {
    return this.request(`/chats/${chatId}/deletion`, { method: 'POST' });
  }

  /**
   * 读取会话的有界历史消息。
   *
   * @param chatId 会话 ID。
   *
   * @param limit 结果数量上限。
   *
   * @returns 函数处理结果。
   */
  listMessages(chatId: string, limit = 100): Promise<Message[]> {
    return this.request(`/chats/${chatId}/messages?limit=${limit}`);
  }

  /**
   * 提交问题并取得持久化回答凭据。
   *
   * @param chatId 会话 ID。
   *
   * @param question 用户问题。
   *
   * @param agentType 首次提问选择的 Agent 类型；已有会话提问时为空。
   *
   * @param idempotencyKey 当前逻辑提问在失败重试期间复用的幂等键。
   *
   * @returns 函数处理结果。
   */
  submitQuestion(
    chatId: string | null,
    question: string,
    agentType: AgentType | null,
    idempotencyKey: string,
  ): Promise<QuestionSubmission> {
    const body = chatId === null ? { chatId, agentType, question } : { chatId, question };
    return this.request('/questions/submission', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
  }

  /**
   * 请求服务端把原问题作为新的完整问答轮次重新发起。
   *
   * @param answerId 回答 ID。
   *
   * @returns 函数处理结果。
   */
  regenerateAnswer(answerId: string): Promise<AnswerSnapshot> {
    return this.request(`/answers/${answerId}/regenerations`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  }

  /**
   * 申请停止回答并返回服务端当前状态。
   *
   * @param answerId 回答 ID。
   *
   * @returns 函数处理结果。
   */
  cancelAnswer(answerId: string): Promise<AnswerSnapshot> {
    return this.request(`/answers/${answerId}/cancellation`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ reason: 'USER_REQUESTED' }),
    });
  }

  /**
   * 读取回答的持久化快照。
   *
   * @param answerId 回答 ID。
   *
   * @returns 函数处理结果。
   */
  getAnswer(answerId: string): Promise<AnswerSnapshot> {
    return this.request(`/answers/${answerId}`);
  }

  /**
   * 保存用户对回答的评价。
   *
   * @param answerId 回答 ID。
   *
   * @param feedback 用户反馈。
   *
   * @returns 函数处理结果。
   */
  recordFeedback(answerId: string, feedback: Feedback): Promise<void> {
    return this.request(`/answers/${answerId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    });
  }

  /**
   * 从已确认事件序号订阅回答流。
   *
   * @param answerId 回答 ID。
   *
   * @param options 流式订阅参数。
   *
   * @returns 函数处理结果。
   */
  async streamAnswer(answerId: string, options: StreamOptions): Promise<void> {
    const headers = new Headers({ Accept: 'text/event-stream' });
    if (options.afterSequence) headers.set('Last-Event-ID', String(options.afterSequence));
    const response = await fetch(this.url(`/answers/${answerId}/events`), {
      headers,
      credentials: 'include',
      signal: options.signal,
    });
    // 事件缺口不能继续拼接，否则会展示残缺答案；交由应用层读取持久化快照。
    if (response.status === 409) throw new ReplayGapError();
    if (!response.ok) throw await problemFrom(response);
    if (!response.body) throw new ApiError('浏览器不支持流式回答', 0);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const idleController = new AbortController();
    /**
     * 取消当前网络读取，仅释放订阅连接，不代表服务端生成已停止。
     */
    const abortReader = (): void => void reader.cancel();
    options.signal.addEventListener('abort', abortReader, { once: true });
    idleController.signal.addEventListener('abort', abortReader, { once: true });
    /**
     * 收到数据后重置空闲计时器，避免流连接无限等待。
     */
    const armIdleTimer = (): void => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idleController.abort(), this.config.streamIdleTimeoutMillis);
    };
    armIdleTimer();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdleTimer();
        parser.push(decoder.decode(value, { stream: true })).forEach(options.onEvent);
      }
      parser.push(decoder.decode()).forEach(options.onEvent);
      parser.finish().forEach(options.onEvent);
      if (idleController.signal.aborted && !options.signal.aborted) {
        throw new ApiError('流式回答等待超时，请重新连接', 0);
      }
    } finally {
      clearTimeout(idleTimer);
      options.signal.removeEventListener('abort', abortReader);
    }
  }

  /**
   * 携带同源凭据并在有界超时内调用 JSON 接口。
   *
   * @param path 接口路径。
   *
   * @param init 请求初始化参数。
   *
   * @returns 函数处理结果。
   */
  private async request<T>(path: string, init: FrontendRequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMillis);
    try {
      const headers = new Headers(init.headers);
      if (init.body && !(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }
      headers.set('Accept', 'application/json, application/problem+json');
      const response = await fetch(this.url(path), {
        ...init,
        headers,
        credentials: 'include',
        signal: controller.signal,
      });
      if (!response.ok) throw await problemFrom(response);
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (controller.signal.aborted) throw new ApiError('请求超时，请稍后重试', 0);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 拼接当前环境的后端接口地址。
   *
   * @param path 接口路径。
   *
   * @returns 函数处理结果。
   */
  private url(path: string): string {
    return `${this.config.apiBaseUrl}${path}`;
  }
}

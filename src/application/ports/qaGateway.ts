import type {
  AnswerSnapshot,
  AnswerStreamEvent,
  AgentType,
  Conversation,
  ConversationPage,
  Feedback,
  Message,
  QuestionSubmission,
} from '../../domain/models';

/**
 * 流式订阅参数，afterSequence 用于断线后从最后已确认事件继续。
 */
export type StreamOptions = {
  /**
   * 中止信号。
   */
  signal: AbortSignal;
  /**
   * 最后确认的事件序号。
   */
  afterSequence?: number;
  /**
   * 事件回调函数。
   *
   * @param event 回答流事件。
   */
  onEvent: (event: AnswerStreamEvent) => void;
};

/**
 * 前端应用层访问问答后端的唯一端口，隔离 HTTP 与 SSE 实现细节。
 */
export interface QaGateway {
  /**
   * 查询当前用户的会话列表。
   *
   * @param cursor 上一页返回的不透明游标。
   * @param limit 结果数量上限。
   *
   * @returns 函数处理结果。
   */
  listConversations(cursor?: string, limit?: number): Promise<ConversationPage>;
  /**
   * 修改指定会话名称。
   *
   * @param chatId 要修改的会话 ID。
   *
   * @param title 会话名称。
   *
   * @returns 函数处理结果。
   */
  renameConversation(chatId: string, title: string): Promise<Conversation>;
  /**
   * 删除当前用户的指定会话。
   *
   * @param chatId 会话 ID。
   *
   * @returns 函数处理结果。
   */
  deleteConversation(chatId: string): Promise<void>;
  /**
   * 读取会话的有界历史消息。
   *
   * @param chatId 会话 ID。
   *
   * @param limit 结果数量上限。
   *
   * @returns 函数处理结果。
   */
  listMessages(chatId: string, limit?: number): Promise<Message[]>;
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
  ): Promise<QuestionSubmission>;
  /**
   * 把原问题作为新的完整问答轮次重新发起。
   *
   * @param answerId 回答 ID。
   *
   * @returns 函数处理结果。
   */
  regenerateAnswer(answerId: string): Promise<AnswerSnapshot>;
  /**
   * 申请停止回答并返回服务端当前状态。
   *
   * @param answerId 回答 ID。
   *
   * @returns 函数处理结果。
   */
  cancelAnswer(answerId: string): Promise<AnswerSnapshot>;
  /**
   * 读取回答的持久化快照。
   *
   * @param answerId 回答 ID。
   *
   * @returns 函数处理结果。
   */
  getAnswer(answerId: string): Promise<AnswerSnapshot>;
  /**
   * 保存用户对回答的评价。
   *
   * @param answerId 回答 ID。
   *
   * @param feedback 用户反馈。
   *
   * @returns 函数处理结果。
   */
  recordFeedback(answerId: string, feedback: Feedback): Promise<void>;
  /**
   * 从已确认事件序号订阅回答流。
   *
   * @param answerId 回答 ID。
   *
   * @param options 流式订阅参数。
   *
   * @returns 函数处理结果。
   */
  streamAnswer(answerId: string, options: StreamOptions): Promise<void>;
}

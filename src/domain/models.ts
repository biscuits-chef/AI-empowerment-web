/**
 * 后端返回的会话摘要。
 */
export type Conversation = {
  /**
   * 唯一标识。
   */
  id: string;
  /**
   * 会话名称。
   */
  title: string;
  /**
   * 创建时间。
   */
  createdAt: string;
  /**
   * 更新时间。
   */
  updatedAt: string;
};

/**
 * 会话稳定游标分页结果。
 */
export type ConversationPage = {
  /** 当前页会话。 */
  items: Conversation[];
  /** 下一页不透明游标；没有更多数据时为空。 */
  nextCursor: string | null;
  /** 是否还有下一页。 */
  hasMore: boolean;
};

/**
 * 前端可选择并随提问提交给后端的 Agent 类型。
 */
export type AgentType =
  'SMART_DATA' | 'SMART_QA' | 'CONTRACT_REVIEW' | 'CONTRACT_COMPARE' | 'CONFIRMATION_CHECK';

/**
 * 统一工作台在前端本地维护的 Agent 定义。
 */
export type AgentDefinition = {
  /** Agent 稳定标识。 */
  id: AgentType;
  /** Agent 中文名称。 */
  name: string;
  /** Agent 能力说明。 */
  description: string;
  /** 当前阶段是否开放。 */
  available: boolean;
  /** 未开放时由前端展示的安全提示。 */
  unavailableMessage?: string | null;
};

/**
 * 用户与助手消息角色。
 */
export type MessageRole = 'USER' | 'ASSISTANT';

/**
 * 随某一条用户消息持久化展示的附件元数据。
 */
export type MessageAttachment = {
  /** 文件唯一标识。 */
  fileId: string;
  /** 安全展示文件名。 */
  name: string;
  /** 服务端识别的内容类型。 */
  contentType: string;
  /** 文件字节数。 */
  sizeBytes: number;
  /** 文件在该次问题中的业务角色。 */
  usage: TemporaryFileUsage;
  /** 文件当前处理状态。 */
  status: TemporaryFileStatus;
};

/**
 * 带持久化状态的历史消息结构。
 */
export type Message = {
  /**
   * 唯一标识。
   */
  id: string;
  /**
   * 回答 ID。
   */
  answerId?: string | null;
  /**
   * 回答状态。
   */
  answerStatus?: AnswerStatus | null;
  /**
   * 消息角色。
   */
  role: MessageRole;
  /**
   * 消息或回答内容。
   */
  content: string;
  /**
   * 创建时间。
   */
  createdAt: string;
  /** 随本次用户问题提交的附件元数据；助手消息和无附件问题为空。 */
  attachments?: MessageAttachment[];
  /** 从服务端恢复的回答执行事件。 */
  executionEvents?: HistoricalExecutionEvent[];
  /** 从服务端恢复的回答产物引用。 */
  artifacts?: MessageArtifact[];
};

/**
 * 历史回答中可恢复的执行事件。
 */
export type HistoricalExecutionEvent = {
  /** 事件稳定序号。 */
  sequence: number;
  /** 事件类型。 */
  type: StreamEventType;
  /** 事件值。 */
  value: string;
  /** 事件发生时间。 */
  occurredAt: string;
};

/**
 * 历史回答中可恢复的产物引用。
 */
export type MessageArtifact = {
  /** 产物类型。 */
  type: 'CITATION';
  /** 产物稳定引用。 */
  reference: string;
};

/**
 * 回答状态机；澄清、未完整回答及停止失败都属于可恢复展示的终态。
 */
export type AnswerStatus =
  | 'PENDING'
  | 'RETRIEVING'
  | 'QUERYING'
  | 'GENERATING'
  | 'NEEDS_CLARIFICATION'
  | 'INCOMPLETE'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'CANCEL_FAILED'
  | 'COMPLETED'
  | 'FAILED';

/**
 * 回答持久化快照，刷新或事件缺口时作为最终事实来源。
 */
export type AnswerSnapshot = {
  /**
   * 回答 ID。
   */
  answerId: string;
  /**
   * 问题 ID。
   */
  questionId: string;
  /**
   * 链路追踪 ID。
   */
  traceId: string;
  /**
   * 此次重生成对应的原回答 ID。
   */
  regeneratedFromAnswerId: string | null;
  /**
   * 回答状态。
   */
  status: AnswerStatus;
  /**
   * 消息或回答内容。
   */
  content: string;
  /**
   * 错误码。
   */
  errorCode: string | null;
  /**
   * 用户停止回答的原因。
   */
  cancelReason: string | null;
  /**
   * 停止时所处的生成阶段。
   */
  cancelledStage: string | null;
  /**
   * 停止失败错误码。
   */
  cancelErrorCode: string | null;
  /**
   * 回答事件订阅地址。
   */
  streamPath: string;
  /**
   * 创建时间。
   */
  createdAt: string;
  /**
   * 回答终态时间。
   */
  completedAt: string | null;
  /**
   * 停止请求时间。
   */
  cancelRequestedAt: string | null;
  /**
   * 停止完成时间。
   */
  cancelledAt: string | null;
};

/**
 * 用户对回答的评价类型。
 */
export type Feedback = 'LIKE' | 'DISLIKE';

/**
 * 临时文件在当前问题中的业务角色。
 */
export type TemporaryFileUsage = 'AUTO' | 'QUERY_INPUT' | 'EVIDENCE';

/**
 * 服务端临时文件处理状态。
 */
export type TemporaryFileStatus = 'UPLOADING' | 'STORED' | 'READY' | 'FAILED' | 'DELETE_PENDING';

/**
 * 会话内已经上传的临时文件元数据。
 */
export type TemporaryFile = {
  /** 文件唯一标识。 */
  id: string;
  /** 所属会话 ID。 */
  conversationId: string;
  /** 安全展示文件名。 */
  name: string;
  /** 服务端识别的内容类型。 */
  contentType: string;
  /** 文件字节数。 */
  sizeBytes: number;
  /** 当前默认使用角色。 */
  usage: TemporaryFileUsage;
  /** 文件处理状态。 */
  status: TemporaryFileStatus;
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
};

/**
 * 问题提交时携带的临时文件引用。
 */
export type QuestionFileReference = {
  /** 文件唯一标识。 */
  fileId: string;
  /** 文件在本次问题中的业务角色。 */
  usage: TemporaryFileUsage;
};

/**
 * 问答流支持的事件类型集合。
 */
export type StreamEventType =
  | 'metadata'
  | 'workflow_plan_selected'
  | 'intent_recognition_started'
  | 'intent_recognized'
  | 'retrieval_started'
  | 'citation'
  | 'knowledge_retrieval_completed'
  | 'business_query_started'
  | 'business_query_completed'
  | 'evidence_reconciliation_started'
  | 'evidence_assessed'
  | 'manual_review_required'
  | 'clarification_required'
  | 'generation_started'
  | 'generation_completed'
  | 'delta'
  | 'cancellation_requested'
  | 'cancelled'
  | 'cancellation_failed'
  | 'completed'
  | 'error';

/**
 * 后端 SSE 流中的有序回答事件。
 */
export type AnswerStreamEvent = {
  /**
   * 唯一标识。
   */
  id: number;
  /**
   * 事件或实体类型。
   */
  type: StreamEventType;
  /**
   * 输入值。
   */
  value: string;
  /**
   * 事件发生时间。
   */
  occurredAt?: string;
};

/**
 * 页面展示消息及临时交互状态。
 */
export type DisplayMessage = Message & {
  /**
   * 回答状态。
   */
  answerStatus?: AnswerStatus;
  /**
   * 答案证据来源列表。
   */
  citations?: string[];
  /**
   * 用户反馈。
   */
  feedback?: Feedback;
  /**
   * 是否需要人工复核。
   */
  needsManualReview?: boolean;
  /**
   * 当前生成阶段提示。
   */
  stageLabel?: string;
  /**
   * 链路追踪 ID。
   */
  traceId?: string;
  /**
   * 面向用户的安全错误提示。
   */
  errorMessage?: string;
};

/**
 * 判断前端是否还需要继续订阅回答事件。
 *
 * @param status 回答状态。
 *
 * @returns 函数处理结果。
 */
export const isTerminalStatus = (status?: AnswerStatus): boolean =>
  status === 'NEEDS_CLARIFICATION' ||
  status === 'COMPLETED' ||
  status === 'INCOMPLETE' ||
  status === 'CANCELLED' ||
  status === 'CANCEL_FAILED' ||
  status === 'FAILED';

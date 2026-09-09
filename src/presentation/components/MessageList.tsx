import { useEffect, useRef, useState } from 'react';
import {
  Ban,
  Check,
  Circle,
  CircleCheck,
  CircleX,
  Clipboard,
  FileText,
  ListTree,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import type {
  DisplayMessage,
  Feedback,
  MessageAttachment,
  TemporaryFileStatus,
  TemporaryFileUsage,
} from '../../domain/models';
import { isTerminalStatus } from '../../domain/models';
import {
  buildExecutionTimeline,
  formatExecutionDuration,
} from '../../application/executionTimeline';
import type { ExecutionStep, ExecutionStepStatus } from '../../application/executionTimeline';
import { MarkdownContent } from './MarkdownContent';

/**
 * 消息列表及回答操作回调属性。
 */
type MessageListProps = {
  /**
   * 消息列表。
   */
  messages: DisplayMessage[];
  /**
   * 停止回答回调。
   *
   * @param answerId 回答 ID。
   */
  onStop: (answerId: string) => void;
  /**
   * 重新生成回调。
   *
   * @param answerId 回答 ID。
   */
  onRegenerate: (answerId: string) => void;
  /**
   * 反馈回调。
   *
   * @param answerId 回答 ID。
   *
   * @param value 输入值。
   */
  onFeedback: (answerId: string, value: Feedback) => void;
};

/**
 * 用户消息附件列表属性。
 */
type MessageAttachmentsProps = {
  /** 随本次用户问题提交的附件元数据。 */
  attachments: MessageAttachment[];
};

/**
 * 将附件字节数格式化为适合消息卡片的简短文本。
 *
 * @param sizeBytes 文件字节数。
 * @returns 用户易读的文件大小。
 */
const formatAttachmentSize = (sizeBytes: number): string =>
  sizeBytes < 1024 ? `${sizeBytes} B` : `${(sizeBytes / 1024).toFixed(1)} KB`;

/**
 * 将附件业务角色转换为中文展示名称。
 *
 * @param usage 附件在该次问题中的业务角色。
 * @returns 中文角色名称。
 */
const attachmentUsageLabel = (usage: TemporaryFileUsage): string => {
  if (usage === 'QUERY_INPUT') return '查询条件';
  if (usage === 'EVIDENCE') return '回答证据';
  return '自动识别用途';
};

/**
 * 将历史附件状态转换为中文展示名称。
 *
 * @param status 文件当前处理状态。
 * @returns 中文状态名称。
 */
const attachmentStatusLabel = (status: TemporaryFileStatus): string => {
  if (status === 'DELETE_PENDING') return '文件已过期';
  if (status === 'FAILED') return '处理失败';
  if (status === 'STORED') return '等待解析或 OCR';
  if (status === 'UPLOADING') return '正在上传';
  return '已随问题提交';
};

/** 白盒执行过程组件属性。 */
type ExecutionProcessProps = {
  /** 当前助手回答。 */
  message: DisplayMessage;
  /** 回答是否仍处于活动状态。 */
  generating: boolean;
};

/**
 * 将执行阶段状态转换为中文。
 *
 * @param status 执行阶段状态。
 * @returns 用户可理解的中文状态。
 */
const executionStatusLabel = (status: ExecutionStepStatus): string => {
  const labels: Record<ExecutionStepStatus, string> = {
    WAITING: '等待中',
    RUNNING: '执行中',
    SUCCEEDED: '已完成',
    ATTENTION: '需关注',
    FAILED: '执行失败',
    CANCELLED: '已停止',
  };
  return labels[status];
};

/**
 * 将 ISO 时间格式化为包含秒的本地时间。
 *
 * @param value ISO 时间字符串。
 * @returns 本地时间；输入无效时返回 undefined。
 */
const formatExecutionTime = (value?: string): string | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/**
 * 根据执行阶段状态返回非颜色化状态图标。
 *
 * @param status 执行阶段状态。
 * @returns 同时使用形状表达状态的图标。
 */
const executionStatusIcon = (status: ExecutionStepStatus) => {
  if (status === 'RUNNING') return <LoaderCircle size={16} aria-hidden="true" />;
  if (status === 'SUCCEEDED') return <CircleCheck size={16} aria-hidden="true" />;
  if (status === 'ATTENTION') return <ShieldAlert size={16} aria-hidden="true" />;
  if (status === 'FAILED') return <CircleX size={16} aria-hidden="true" />;
  if (status === 'CANCELLED') return <Ban size={16} aria-hidden="true" />;
  return <Circle size={16} aria-hidden="true" />;
};

/**
 * 返回阶段时间、状态与耗时组成的辅助文本。
 *
 * @param step 执行阶段视图。
 * @returns 阶段时间和耗时说明。
 */
const executionStepMeta = (step: ExecutionStep): string => {
  const startedAt = formatExecutionTime(step.startedAt);
  const duration = formatExecutionDuration(step.durationMs);
  if (startedAt && duration) return `${startedAt} 开始 · 耗时 ${duration}`;
  if (startedAt && step.status === 'RUNNING') return `${startedAt} 开始 · 正在执行`;
  if (startedAt) return `${startedAt} 开始`;
  return '等待前序阶段完成';
};

/**
 * 展示可恢复、可核验且不泄露内部敏感实现的五阶段执行时间线。
 *
 * @param 参数1 解构后的组件属性，各字段含义见对应属性类型。
 * @returns 可展开的白盒执行过程。
 */
const ExecutionProcess = ({ message, generating }: ExecutionProcessProps) => {
  const timeline = buildExecutionTimeline(message.executionEvents ?? [], message.answerStatus);
  return (
    <details className="execution-process" open={generating}>
      <summary>
        <span className="execution-process__agent" aria-hidden="true">
          <Sparkles size={15} />
        </span>
        <span>
          <strong>执行过程</strong>
          <small>{generating ? message.stageLabel || '正在执行任务' : '执行轨迹已保存'}</small>
        </span>
        <span className="execution-process__count">
          {timeline.settledSteps}/{timeline.totalSteps} 个阶段
        </span>
      </summary>
      <div className="execution-process__body">
        <div className="execution-process__overview">
          <span>{timeline.scenario}</span>
          {timeline.planVersion && <span>流程版本 v{timeline.planVersion}</span>}
          {message.traceId && <span title={message.traceId}>运行编号 {message.traceId}</span>}
        </div>
        <p className="execution-process__safety">
          为保护业务安全，页面展示可核验阶段和结果摘要，不展示内部提示词、原始 SQL、服务地址或密钥。
        </p>
        <ol className="execution-timeline">
          {timeline.steps.map((step) => (
            <li
              className={`execution-timeline__step execution-timeline__step--${step.status.toLowerCase()}`}
              key={step.id}
              aria-current={step.status === 'RUNNING' ? 'step' : undefined}
            >
              <span className="execution-timeline__marker">{executionStatusIcon(step.status)}</span>
              <div className="execution-timeline__content">
                <header>
                  <strong>{step.title}</strong>
                  <span>{executionStatusLabel(step.status)}</span>
                </header>
                <p>{step.description}</p>
                <small className="execution-timeline__detail">{step.detail}</small>
                <small className="execution-timeline__meta">{executionStepMeta(step)}</small>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
};

/**
 * 展示一条用户消息随问题提交的附件元数据，不提供绕过授权的下载地址。
 *
 * @param 参数1 解构后的组件属性，各字段含义见对应属性类型。
 * @returns 附件元数据卡片列表。
 */
const MessageAttachments = ({ attachments }: MessageAttachmentsProps) => (
  <ul className="message-attachments" aria-label="本次提问附件">
    {attachments.map((attachment) => (
      <li className="message-attachment" key={attachment.fileId}>
        <FileText size={17} aria-hidden="true" />
        <span className="message-attachment__summary">
          <strong title={attachment.name}>{attachment.name}</strong>
          <small>
            {formatAttachmentSize(attachment.sizeBytes)} · {attachmentUsageLabel(attachment.usage)}
          </small>
        </span>
        <span
          className={`message-attachment__status message-attachment__status--${attachment.status.toLowerCase()}`}
        >
          {attachmentStatusLabel(attachment.status)}
        </span>
      </li>
    ))}
  </ul>
);

/**
 * 仅为成功完成的回答提供复制、反馈和重新生成操作。
 *
 * @param 参数1 解构后的组件属性，各字段含义见对应属性类型。
 *
 * @returns 函数处理结果。
 */
const AnswerActions = ({
  message,
  onRegenerate,
  onFeedback,
}: {
  /**
   * 消息。
   */
  message: DisplayMessage;
  /**
   * 重新生成回调。
   *
   * @param answerId 回答 ID。
   */
  onRegenerate: (answerId: string) => void;
  /**
   * 反馈回调。
   *
   * @param answerId 回答 ID。
   *
   * @param value 输入值。
   */
  onFeedback: (answerId: string, value: Feedback) => void;
}) => {
  const [copied, setCopied] = useState(false);
  if (!message.answerId || message.answerStatus !== 'COMPLETED') return null;
  /**
   * 将完整回答复制到系统剪贴板。
   *
   * @returns 函数处理结果。
   */
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="answer-actions" aria-label="回答操作">
      <button className="icon-button" aria-label="复制回答" onClick={() => void copy()}>
        {copied ? <Check size={16} /> : <Clipboard size={16} />}
      </button>
      <button
        className={`icon-button ${message.feedback === 'LIKE' ? 'is-selected' : ''}`}
        aria-label="喜欢这个回答"
        onClick={() => onFeedback(message.answerId!, 'LIKE')}
      >
        <ThumbsUp size={16} />
      </button>
      <button
        className={`icon-button ${message.feedback === 'DISLIKE' ? 'is-selected' : ''}`}
        aria-label="不喜欢这个回答"
        onClick={() => onFeedback(message.answerId!, 'DISLIKE')}
      >
        <ThumbsDown size={16} />
      </button>
      <button
        className="icon-button"
        aria-label="重新生成回答"
        onClick={() => onRegenerate(message.answerId!)}
      >
        <RefreshCw size={16} />
      </button>
    </div>
  );
};

/**
 * 展示流式消息、来源、人工复核提示及回答状态相关操作。
 *
 * @param 参数1 解构后的组件属性，各字段含义见对应属性类型。
 *
 * @returns 函数处理结果。
 */
export const MessageList = ({ messages, onStop, onRegenerate, onFeedback }: MessageListProps) => {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 显式使用代码块保证副作用不把浏览器滚动实现的返回值误交给 React 作为清理函数。
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="message-list" aria-live="polite">
      {messages.map((message) => {
        const generating = message.answerId && !isTerminalStatus(message.answerStatus);
        return (
          <article className={`message message--${message.role.toLowerCase()}`} key={message.id}>
            {message.role === 'ASSISTANT' && <div className="assistant-mark">智</div>}
            <div className="message__body">
              {message.role === 'USER' && message.attachments && message.attachments.length > 0 && (
                <MessageAttachments attachments={message.attachments} />
              )}
              {message.role === 'ASSISTANT' &&
                message.executionEvents &&
                message.executionEvents.length > 0 && (
                  <ExecutionProcess message={message} generating={Boolean(generating)} />
                )}
              {message.content && (
                <div className="message__content">
                  {message.role === 'ASSISTANT' && (
                    <div className="result-heading">
                      <Sparkles size={15} aria-hidden="true" />
                      <span>执行结果</span>
                    </div>
                  )}
                  {message.role === 'ASSISTANT' ? (
                    <MarkdownContent content={message.content} />
                  ) : (
                    message.content
                  )}
                </div>
              )}
              {message.stageLabel && (
                <div className="generation-status">
                  <span className="status-pulse" aria-hidden="true" />
                  {message.stageLabel}
                </div>
              )}
              {message.needsManualReview && (
                <div className="review-alert" role="alert">
                  <ShieldAlert size={18} />
                  <div>
                    <strong>需要人工复核</strong>
                    <span>知识库与业务数据库的证据不一致，回答中将保留两个通道的信息。</span>
                  </div>
                </div>
              )}
              {message.citations && message.citations.length > 0 && (
                <details className="citations">
                  <summary>
                    <ListTree size={15} aria-hidden="true" />
                    来源与产物（{message.citations.length}）
                  </summary>
                  <ul>
                    {message.citations.map((citation) => (
                      <li key={citation}>
                        <FileText size={16} aria-hidden="true" />
                        <span>
                          <strong>{citation}</strong>
                          <small>已关联到本次回答</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {message.errorMessage && <p className="message-error">{message.errorMessage}</p>}
              {generating && (
                <button className="stop-button" onClick={() => onStop(message.answerId!)}>
                  <Square size={12} fill="currentColor" /> 停止生成
                </button>
              )}
              <AnswerActions
                message={message}
                onRegenerate={onRegenerate}
                onFeedback={onFeedback}
              />
            </div>
          </article>
        );
      })}
      <div ref={endRef} />
    </div>
  );
};

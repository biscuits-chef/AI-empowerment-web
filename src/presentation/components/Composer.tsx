import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  ArrowUp,
  ChartNoAxesCombined,
  Check,
  FileText,
  LoaderCircle,
  Paperclip,
  Square,
  X,
} from 'lucide-react';
import type {
  AgentDefinition,
  AgentType,
  TemporaryFile,
  TemporaryFileUsage,
} from '../../domain/models';

/**
 * 问题输入组件属性。
 */
type ComposerProps = {
  /** 前端本地配置且允许在输入区选择的 Agent 目录。 */
  agents: readonly AgentDefinition[];
  /** 当前选中的 Agent 类型。 */
  activeAgentType: AgentType;
  /**
   * 切换当前 Agent 的回调。
   *
   * @param agentType 用户选择的 Agent 类型。
   */
  onAgentChange: (agentType: AgentType) => void;
  /** 当前执行中的回答 ID；为空时显示发送按钮。 */
  activeAnswerId?: string;
  /**
   * 禁用状态。
   */
  disabled: boolean;
  /**
   * 最大字符数。
   */
  maxCharacters: number;
  /**
   * 输入值。
   */
  value: string;
  /** 已上传并准备随本次问题提交的附件。 */
  attachments: TemporaryFile[];
  /** 是否正在上传附件。 */
  uploading: boolean;
  /**
   * 内容变更回调。
   *
   * @param value 输入值。
   */
  onChange: (value: string) => void;
  /**
   * 提交回调。
   *
   * @param question 用户问题。
   */
  onSubmit: (question: string) => void;
  /**
   * 用户选择文件回调。
   *
   * @param files 浏览器选择的文件列表。
   */
  onFilesSelected: (files: File[]) => void;
  /**
   * 删除当前待提交附件回调。
   *
   * @param fileId 文件 ID。
   */
  onRemoveAttachment: (fileId: string) => void;
  /**
   * 修改当前问题中的附件角色。
   *
   * @param fileId 文件 ID。
   * @param usage 新业务角色。
   */
  onAttachmentUsageChange: (fileId: string, usage: TemporaryFileUsage) => void;
  /**
   * 停止当前执行中回答。
   *
   * @param answerId 回答 ID。
   */
  onStop?: (answerId: string) => void;
};

/**
 * 将文件字节数格式化为用户易读文本。
 *
 * @param sizeBytes 文件字节数。
 * @returns 用户易读大小。
 */
const formatSize = (sizeBytes: number): string =>
  sizeBytes < 1024 ? `${sizeBytes} B` : `${(sizeBytes / 1024).toFixed(1)} KB`;

/**
 * 将服务端文件状态转换为安全中文提示。
 *
 * @param file 临时文件。
 * @returns 文件状态提示。
 */
const fileStatus = (file: TemporaryFile): string => {
  if (file.status === 'READY') return '已就绪';
  if (file.status === 'FAILED') return '处理失败';
  if (file.status === 'STORED') return '等待解析或 OCR';
  return '正在上传';
};

/**
 * 提供有长度上限、可防重复提交的问题输入区。
 *
 * @param 参数1 解构后的组件属性，各字段含义见对应属性类型。
 *
 * @returns 函数处理结果。
 */
export const Composer = ({
  agents,
  activeAgentType,
  onAgentChange,
  activeAnswerId,
  disabled,
  maxCharacters,
  value,
  attachments,
  uploading,
  onChange,
  onSubmit,
  onFilesSelected,
  onRemoveAttachment,
  onAttachmentUsageChange,
  onStop = () => undefined,
}: ComposerProps) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const agentMenu = useRef<HTMLDivElement>(null);
  const agentMenuTrigger = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const filesReady = attachments.every((file) => file.status === 'READY');
  const availableAgents = agents.filter(({ available }) => available);
  const activeAgent =
    availableAgents.find(({ id }) => id === activeAgentType) ?? availableAgents[0];

  useEffect(() => {
    if (!agentMenuOpen) return undefined;

    /**
     * 点击 Agent 菜单以外区域时关闭展开层。
     *
     * @param event 浏览器指针事件。
     */
    const closeAgentMenuOnOutsidePointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && !agentMenu.current?.contains(event.target)) {
        setAgentMenuOpen(false);
      }
    };

    /**
     * 按下退出键时关闭 Agent 菜单并将焦点还给触发按钮。
     *
     * @param event 浏览器键盘事件。
     */
    const closeAgentMenuOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setAgentMenuOpen(false);
      agentMenuTrigger.current?.focus();
    };

    document.addEventListener('pointerdown', closeAgentMenuOnOutsidePointer);
    document.addEventListener('keydown', closeAgentMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeAgentMenuOnOutsidePointer);
      document.removeEventListener('keydown', closeAgentMenuOnEscape);
    };
  }, [agentMenuOpen]);

  /**
   * 校验输入后提交当前问题。
   */
  const submit = (): void => {
    const question = value.trim();
    if (!question || disabled || uploading || !filesReady) return;
    onSubmit(question);
  };

  /**
   * 接收拖入输入区的文件并复位拖拽状态。
   *
   * @param event 浏览器拖放事件。
   */
  const dropFiles = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (disabled || uploading) return;
    onFilesSelected(Array.from(event.dataTransfer.files));
  };

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${dragging ? 'is-dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled && !uploading) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={dropFiles}
      >
        {attachments.length > 0 && (
          <ul className="attachment-list" aria-label="待发送附件">
            {attachments.map((file) => (
              <li className="attachment-item" key={file.id}>
                <FileText size={18} aria-hidden="true" />
                <div className="attachment-item__summary">
                  <strong title={file.name}>{file.name}</strong>
                  <span>
                    {formatSize(file.sizeBytes)} · {fileStatus(file)}
                  </span>
                </div>
                <select
                  aria-label={`设置附件用途：${file.name}`}
                  value={file.usage}
                  disabled={disabled}
                  onChange={(event) =>
                    onAttachmentUsageChange(file.id, event.target.value as TemporaryFileUsage)
                  }
                >
                  <option value="AUTO">自动识别用途</option>
                  <option value="QUERY_INPUT">作为查询条件</option>
                  <option value="EVIDENCE">作为回答证据</option>
                </select>
                <button
                  className="attachment-remove"
                  type="button"
                  aria-label={`删除附件：${file.name}`}
                  disabled={disabled}
                  onClick={() => onRemoveAttachment(file.id)}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          rows={1}
          disabled={disabled}
          value={value}
          maxLength={maxCharacters}
          placeholder={`向${activeAgent?.name ?? '智能助手'}描述你想完成的任务`}
          aria-label="输入问题"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer__footer">
          <button
            className="attachment-button"
            type="button"
            aria-label="上传附件"
            disabled={disabled || uploading || attachments.length >= 5}
            title="支持 PDF、DOCX、XLSX、TXT、MD、JPG、PNG，单文件不超过 1 MiB"
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? <LoaderCircle className="spin" size={19} /> : <Paperclip size={19} />}
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.txt,.md,.jpg,.jpeg,.png"
            aria-label="选择附件"
            onChange={(event) => {
              onFilesSelected(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <div className="composer__agent" ref={agentMenu}>
            <button
              ref={agentMenuTrigger}
              className="composer__agent-trigger"
              type="button"
              aria-label={`选择问答功能，当前：${activeAgent?.name ?? '未选择'}`}
              aria-haspopup="listbox"
              aria-expanded={agentMenuOpen}
              aria-controls="composer-agent-menu"
              disabled={disabled}
              onClick={() => setAgentMenuOpen((open) => !open)}
            >
              <ChartNoAxesCombined size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{activeAgent?.name ?? '选择 Agent'}</span>
            </button>
            {agentMenuOpen && (
              <div
                className="composer__agent-menu"
                id="composer-agent-menu"
                role="listbox"
                aria-label="问答功能"
              >
                {availableAgents.map((agent) => (
                  <button
                    className={`composer__agent-option ${agent.id === activeAgentType ? 'is-selected' : ''}`}
                    key={agent.id}
                    type="button"
                    role="option"
                    aria-selected={agent.id === activeAgentType}
                    onClick={() => {
                      onAgentChange(agent.id);
                      setAgentMenuOpen(false);
                    }}
                  >
                    <span className="composer__agent-option-icon" aria-hidden="true">
                      <ChartNoAxesCombined size={17} strokeWidth={1.8} />
                    </span>
                    <strong>{agent.name}</strong>
                    {agent.id === activeAgentType && (
                      <Check size={16} strokeWidth={2} aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            )}
            <small className="composer__verification-badge">双通道核验</small>
          </div>
          <span className="character-count">
            {value.length > maxCharacters * 0.8 ? `${value.length}/${maxCharacters}` : ''}
          </span>
          {activeAnswerId ? (
            <button
              className="composer-stop-button"
              type="button"
              aria-label="停止生成"
              onClick={() => onStop(activeAnswerId)}
            >
              <Square size={11} fill="currentColor" />
              <span>停止</span>
            </button>
          ) : (
            <button
              className="send-button"
              aria-label="发送问题"
              disabled={disabled || uploading || !filesReady || !value.trim()}
              onClick={submit}
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      <p className="composer-hint">
        回车发送，Shift + Enter 换行 · 支持拖拽上传文件 · 关键业务信息仍需人工确认
      </p>
    </div>
  );
};

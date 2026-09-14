import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChartNoAxesCombined, Check, Square } from 'lucide-react';
import type { AgentDefinition, AgentType } from '../../domain/models';

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
  /** 仅在新建会话首次提问前允许展示 Agent 选择器。 */
  showAgentSelector: boolean;
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
   * 停止当前执行中回答。
   *
   * @param answerId 回答 ID。
   */
  onStop?: (answerId: string) => void;
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
  showAgentSelector,
  activeAnswerId,
  disabled,
  maxCharacters,
  value,
  onChange,
  onSubmit,
  onStop = () => undefined,
}: ComposerProps) => {
  const agentMenu = useRef<HTMLDivElement>(null);
  const agentMenuTrigger = useRef<HTMLButtonElement>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
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
    if (!question || disabled) return;
    onSubmit(question);
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
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
          <div className="composer__agent" ref={agentMenu}>
            {showAgentSelector && (
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
            )}
            {showAgentSelector && agentMenuOpen && (
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
              disabled={disabled || !value.trim()}
              onClick={submit}
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      <p className="composer-hint">回车发送，Shift + Enter 换行 · 关键业务信息仍需人工确认</p>
    </div>
  );
};

import { ArrowUpRight, FileSearch, Landmark, RefreshCw, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

/** 欢迎页属性。 */
type WelcomeProps = {
  /** 位于欢迎说明与快捷问题之间的主输入区。 */
  children?: ReactNode;
  /**
   * 快捷问题选择回调。
   *
   * @param value 输入值。
   */
  onSuggestion: (value: string) => void;
};

const suggestions = [
  { icon: Landmark, text: '查询某产品的产品经理、投资经理和基础信息' },
  { icon: RefreshCw, text: '查询某产品最新的费率调整计划' },
  { icon: FileSearch, text: '提取最新产品说明书中的关键要素' },
];

/**
 * 无历史消息时展示第一阶段问答范围和快捷问题。
 *
 * @param 参数1 解构后的组件属性，各字段含义见对应属性类型。
 *
 * @returns 函数处理结果。
 */
export const Welcome = ({ children, onSuggestion }: WelcomeProps) => (
  <section className="welcome" aria-labelledby="welcome-title">
    <div className="welcome__mark" aria-hidden="true">
      <Sparkles size={24} />
    </div>
    <span className="welcome__eyebrow">智浦小鹿工作台</span>
    <h1 id="welcome-title">今天想完成什么？</h1>
    <p>描述你的业务目标，我会规划步骤、调用工具并核对知识库与业务数据。</p>
    {children}
    <div className="suggestion-grid">
      {suggestions.map(({ icon: Icon, text }) => (
        <button key={text} className="suggestion-card" onClick={() => onSuggestion(text)}>
          <span className="suggestion-card__icon">
            <Icon size={18} />
          </span>
          <span>{text}</span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  </section>
);

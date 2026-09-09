import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * 应用错误边界属性。
 */
type ApplicationErrorBoundaryProps = {
  /**
   * 受保护的页面内容。
   */
  children: ReactNode;
};

/**
 * 应用错误边界状态。
 */
type ApplicationErrorBoundaryState = {
  /**
   * 是否捕获到未处理的渲染异常。
   */
  failed: boolean;
};

/**
 * 捕获组件渲染和副作用异常，避免整个页面退化为空白屏幕。
 */
export class ApplicationErrorBoundary extends Component<
  ApplicationErrorBoundaryProps,
  ApplicationErrorBoundaryState
> {
  /**
   * 初始化错误边界状态。
   */
  override state: ApplicationErrorBoundaryState = { failed: false };

  /**
   * 将未处理异常转换为安全降级页面状态。
   *
   * @param error 未处理异常。
   *
   * @returns 错误降级状态。
   */
  static getDerivedStateFromError(error: Error): ApplicationErrorBoundaryState {
    void error;
    return { failed: true };
  }

  /**
   * 接收组件异常上下文但不向浏览器日志输出问题和回答内容。
   *
   * @param error 未处理异常。
   *
   * @param errorInfo React 组件异常上下文。
   */
  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 生产环境应由脱敏监控适配器上报；当前不输出异常对象，避免泄露业务内容。
    void error;
    void errorInfo;
  }

  /**
   * 展示正常页面或可恢复的安全错误页面。
   *
   * @returns 当前错误状态对应的页面内容。
   */
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="application-error" role="alert">
        <h1>页面显示出现异常</h1>
        <p>当前页面没有正确完成渲染，请刷新后重试。已经提交的问题仍以后端保存结果为准。</p>
        <button type="button" onClick={() => window.location.reload()}>
          刷新页面
        </button>
      </main>
    );
  }
}

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationErrorBoundary } from './ApplicationErrorBoundary';

/**
 * 在渲染阶段抛出异常的测试组件。
 *
 * @returns 此函数始终抛出异常，不返回页面内容。
 */
const ThrowingChild = (): never => {
  throw new Error('测试渲染异常');
};

afterEach(() => vi.restoreAllMocks());

describe('ApplicationErrorBoundary', () => {
  it('捕获渲染异常并展示可恢复页面而不是白屏', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ApplicationErrorBoundary>
        <ThrowingChild />
      </ApplicationErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('页面显示出现异常');
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument();
  });
});

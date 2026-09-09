import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from './MarkdownContent';

describe('MarkdownContent', () => {
  it('展示标题、列表和业务结果表格', () => {
    render(
      <MarkdownContent
        content={
          '# 查询结果\n\n- 已核验知识库\n- 已核验业务库\n\n| 产品代码 | 费率 |\n| --- | --- |\n| P001 | 0.3% |'
        }
      />,
    );

    expect(screen.getByRole('heading', { name: '查询结果' })).toBeInTheDocument();
    expect(screen.getByText('已核验知识库')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('P001');
    expect(screen.getByRole('table')).toHaveTextContent('0.3%');
  });

  it('把模型返回的原始 HTML 当作文本而不是可执行节点', () => {
    const { container } = render(<MarkdownContent content={'<img src=x onerror=alert(1)>'} />);

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });
});

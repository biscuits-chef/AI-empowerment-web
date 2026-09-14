import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

describe('Composer', () => {
  it('展示一期唯一开放的智能问数菜单并支持关闭', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        agents={[{ id: 'SMART_DATA', name: '智能问数', description: '', available: true }]}
        activeAgentType="SMART_DATA"
        onAgentChange={vi.fn()}
        showAgentSelector
        disabled={false}
        maxCharacters={100}
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const selector = screen.getByRole('button', {
      name: '选择问答功能，当前：智能问数',
    });
    expect(selector).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('上传附件')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('向智能问数描述你想完成的任务')).toBeInTheDocument();

    await user.click(selector);
    expect(selector).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: '问答功能' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');

    await user.click(document.body);
    expect(screen.queryByRole('listbox', { name: '问答功能' })).not.toBeInTheDocument();

    await user.click(selector);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: '问答功能' })).not.toBeInTheDocument();
    expect(selector).toHaveFocus();
  });

  it('回车提交并支持换行', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(
      <Composer
        agents={[{ id: 'SMART_DATA', name: '智能问数', description: '', available: true }]}
        activeAgentType="SMART_DATA"
        onAgentChange={vi.fn()}
        showAgentSelector
        disabled={false}
        maxCharacters={10}
        value=""
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText('发送问题')).toBeDisabled();
    rerender(
      <Composer
        agents={[{ id: 'SMART_DATA', name: '智能问数', description: '', available: true }]}
        activeAgentType="SMART_DATA"
        onAgentChange={vi.fn()}
        showAgentSelector
        disabled={false}
        maxCharacters={10}
        value="测试问题"
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );
    await user.type(screen.getByLabelText('输入问题'), '{enter}');
    expect(onSubmit).toHaveBeenCalledWith('测试问题');
    await user.type(screen.getByLabelText('输入问题'), '{shift>}{enter}{/shift}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('一期不提供文件上传并在回答执行中提供停止操作', () => {
    const onStop = vi.fn();
    render(
      <Composer
        agents={[{ id: 'SMART_DATA', name: '智能问数', description: '', available: true }]}
        activeAgentType="SMART_DATA"
        onAgentChange={vi.fn()}
        showAgentSelector
        activeAnswerId="answer-1"
        disabled={false}
        maxCharacters={100}
        value="继续查询"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onStop={onStop}
      />,
    );

    expect(screen.queryByLabelText('选择附件')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('停止生成'));
    expect(onStop).toHaveBeenCalledWith('answer-1');
    expect(screen.queryByLabelText('发送问题')).not.toBeInTheDocument();
  });

  it('已有会话隐藏 Agent 选择器但保留问题输入能力', () => {
    render(
      <Composer
        agents={[{ id: 'SMART_DATA', name: '智能问数', description: '', available: true }]}
        activeAgentType="SMART_DATA"
        onAgentChange={vi.fn()}
        showAgentSelector={false}
        disabled={false}
        maxCharacters={100}
        value="继续提问"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/选择问答功能/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('输入问题')).toBeInTheDocument();
    expect(screen.getByLabelText('发送问题')).toBeEnabled();
  });
});

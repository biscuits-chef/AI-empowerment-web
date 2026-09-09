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
        disabled={false}
        maxCharacters={100}
        value=""
        attachments={[]}
        uploading={false}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onFilesSelected={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onAttachmentUsageChange={vi.fn()}
      />,
    );

    const selector = screen.getByRole('button', {
      name: '选择问答功能，当前：智能问数',
    });
    expect(selector).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('上传附件')).toHaveTextContent('');
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
        disabled={false}
        maxCharacters={10}
        value=""
        attachments={[]}
        uploading={false}
        onChange={onChange}
        onSubmit={onSubmit}
        onFilesSelected={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onAttachmentUsageChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('发送问题')).toBeDisabled();
    rerender(
      <Composer
        agents={[{ id: 'SMART_DATA', name: '智能问数', description: '', available: true }]}
        activeAgentType="SMART_DATA"
        onAgentChange={vi.fn()}
        disabled={false}
        maxCharacters={10}
        value="测试问题"
        attachments={[]}
        uploading={false}
        onChange={onChange}
        onSubmit={onSubmit}
        onFilesSelected={vi.fn()}
        onRemoveAttachment={vi.fn()}
        onAttachmentUsageChange={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText('输入问题'), '{enter}');
    expect(onSubmit).toHaveBeenCalledWith('测试问题');
    await user.type(screen.getByLabelText('输入问题'), '{shift>}{enter}{/shift}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('选择附件、修改用途并删除待发送附件', async () => {
    const user = userEvent.setup();
    const onFilesSelected = vi.fn();
    const onRemoveAttachment = vi.fn();
    const onAttachmentUsageChange = vi.fn();
    render(
      <Composer
        agents={[{ id: 'SMART_DATA', name: '智能问数', description: '', available: true }]}
        activeAgentType="SMART_DATA"
        onAgentChange={vi.fn()}
        disabled={false}
        maxCharacters={100}
        value="查询附件中的产品"
        attachments={[
          {
            id: 'file-1',
            conversationId: 'chat-1',
            name: '产品编号.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeBytes: 1024,
            usage: 'AUTO',
            status: 'READY',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
        ]}
        uploading={false}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onFilesSelected={onFilesSelected}
        onRemoveAttachment={onRemoveAttachment}
        onAttachmentUsageChange={onAttachmentUsageChange}
      />,
    );

    await user.selectOptions(screen.getByLabelText('设置附件用途：产品编号.xlsx'), 'QUERY_INPUT');
    expect(onAttachmentUsageChange).toHaveBeenCalledWith('file-1', 'QUERY_INPUT');
    await user.click(screen.getByLabelText('删除附件：产品编号.xlsx'));
    expect(onRemoveAttachment).toHaveBeenCalledWith('file-1');

    const file = new File(['内容'], '说明.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText('选择附件'), file);
    expect(onFilesSelected).toHaveBeenCalledWith([file]);
  });

  it('支持拖拽附件并在回答执行中提供停止操作', () => {
    const onFilesSelected = vi.fn();
    const onStop = vi.fn();
    const file = new File(['P001'], '产品编号.txt', { type: 'text/plain' });
    const { container } = render(
      <Composer
        agents={[{ id: 'SMART_DATA', name: '智能问数', description: '', available: true }]}
        activeAgentType="SMART_DATA"
        onAgentChange={vi.fn()}
        activeAnswerId="answer-1"
        disabled={false}
        maxCharacters={100}
        value="继续查询"
        attachments={[]}
        uploading={false}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onFilesSelected={onFilesSelected}
        onRemoveAttachment={vi.fn()}
        onAttachmentUsageChange={vi.fn()}
        onStop={onStop}
      />,
    );

    fireEvent.drop(container.querySelector('.composer')!, { dataTransfer: { files: [file] } });
    expect(onFilesSelected).toHaveBeenCalledWith([file]);
    fireEvent.click(screen.getByLabelText('停止生成'));
    expect(onStop).toHaveBeenCalledWith('answer-1');
    expect(screen.queryByLabelText('发送问题')).not.toBeInTheDocument();
  });
});

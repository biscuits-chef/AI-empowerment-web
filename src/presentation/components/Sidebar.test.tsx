import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '../../domain/models';
import { Sidebar } from './Sidebar';

const conversations: Conversation[] = [
  { id: 'chat-1', title: '产品信息', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'chat-2', title: '交易信息', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
];

describe('Sidebar', () => {
  it('按浏览器本地自然日分为今天、昨天和更早', () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 10);
    const earlier = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 10);
    render(
      <Sidebar
        conversations={[
          {
            id: 'today',
            title: '今天会话',
            createdAt: today.toISOString(),
            updatedAt: today.toISOString(),
          },
          {
            id: 'yesterday',
            title: '昨天会话',
            createdAt: yesterday.toISOString(),
            updatedAt: yesterday.toISOString(),
          },
          {
            id: 'earlier',
            title: '更早会话',
            createdAt: earlier.toISOString(),
            updatedAt: earlier.toISOString(),
          },
        ]}
        activeChatId={null}
        open
        onClose={vi.fn()}
        onNewChat={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('今天')).toBeInTheDocument();
    expect(screen.getByText('昨天')).toBeInTheDocument();
    expect(screen.getByText('更早')).toBeInTheDocument();
    expect(screen.getByText('今天会话')).toBeInTheDocument();
    expect(screen.getByText('昨天会话')).toBeInTheDocument();
    expect(screen.getByText('更早会话')).toBeInTheDocument();
    expect(screen.queryByText('最近')).not.toBeInTheDocument();
  });

  it('支持选择、搜索、新建和关闭', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onNewChat = vi.fn();
    const onClose = vi.fn();
    render(
      <Sidebar
        conversations={conversations}
        activeChatId="chat-1"
        open
        onClose={onClose}
        onNewChat={onNewChat}
        onSelect={onSelect}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await user.click(screen.getByText('产品信息'));
    expect(onSelect).toHaveBeenCalledWith('chat-1');
    await user.type(screen.getByPlaceholderText('搜索聊天'), '交易');
    expect(screen.queryByText('产品信息')).not.toBeInTheDocument();
    await user.click(screen.getByText('新建会话'));
    expect(onNewChat).toHaveBeenCalled();
    await user.click(screen.getAllByLabelText('关闭侧边栏')[0]!);
    expect(onClose).toHaveBeenCalled();
  });

  it('固定会话图标尺寸并在悬停长标题时滚动展示剩余内容', () => {
    const longTitle = '查询某产品的产品经理、投资经理和最新费率调整计划';
    render(
      <Sidebar
        conversations={[
          {
            id: 'long-title',
            title: longTitle,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]}
        activeChatId={null}
        open={false}
        onClose={vi.fn()}
        onNewChat={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const titleText = screen.getByText(longTitle);
    const titleViewport = titleText.parentElement!;
    Object.defineProperty(titleText, 'scrollWidth', { configurable: true, value: 280 });
    Object.defineProperty(titleViewport, 'clientWidth', { configurable: true, value: 100 });

    fireEvent.mouseEnter(titleViewport);
    expect(titleViewport).toHaveClass('is-scrolling');
    expect(titleViewport).toHaveStyle({
      '--conversation-title-offset': '-180px',
      '--conversation-title-duration': '6000ms',
    });
    fireEvent.mouseLeave(titleViewport);
    expect(titleViewport).not.toHaveClass('is-scrolling');
    expect(titleViewport).toHaveAttribute('title', longTitle);
    expect(document.querySelector('.conversation-item__icon')).toHaveAttribute('width', '18');
    expect(document.querySelector('.conversation-item__icon')).toHaveAttribute('height', '18');
  });

  it('使用页面对话框重命名并允许点击空白处关闭', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <Sidebar
        conversations={conversations}
        activeChatId={null}
        open={false}
        onClose={vi.fn()}
        onNewChat={vi.fn()}
        onSelect={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );
    await user.click(screen.getByLabelText('管理聊天：产品信息'));
    await user.click(screen.getByText('修改名称'));
    const renameDialog = screen.getByRole('dialog', { name: '修改聊天名称' });
    expect(renameDialog).toBeInTheDocument();
    expect(renameDialog.tagName).toBe('DIALOG');
    expect(renameDialog).toHaveAttribute('open');
    expect(renameDialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('conversation-dialog-backdrop')).toHaveAttribute('tabindex', '-1');
    const titleInput = screen.getByLabelText('聊天名称');
    expect(titleInput).toHaveFocus();
    expect(titleInput).toHaveValue('产品信息');
    await user.clear(titleInput);
    await user.type(titleInput, ' 新名称 ');
    await user.click(screen.getByRole('button', { name: '保存名称' }));
    expect(onRename).toHaveBeenCalledWith('chat-1', '新名称');

    await user.click(screen.getByLabelText('管理聊天：产品信息'));
    await user.click(screen.getByText('修改名称'));
    await user.click(screen.getByTestId('conversation-dialog-backdrop'));
    expect(screen.queryByRole('dialog', { name: '修改聊天名称' })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('管理聊天：产品信息'));
    await user.click(screen.getByText('修改名称'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '修改聊天名称' })).not.toBeInTheDocument();
  });

  it('支持点击外部和按 Esc 关闭会话操作菜单', async () => {
    const user = userEvent.setup();
    render(
      <Sidebar
        conversations={conversations}
        activeChatId={null}
        open={false}
        onClose={vi.fn()}
        onNewChat={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText('管理聊天：产品信息'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByPlaceholderText('搜索聊天'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('管理聊天：产品信息'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('使用页面确认框删除会话并支持取消', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <Sidebar
        conversations={conversations}
        activeChatId={null}
        open={false}
        onClose={vi.fn()}
        onNewChat={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByLabelText('管理聊天：产品信息'));
    await user.click(screen.getByText('删除'));
    expect(screen.getByRole('alertdialog', { name: '删除聊天' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消删除' }));
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('管理聊天：产品信息'));
    await user.click(screen.getByText('删除'));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    expect(onDelete).toHaveBeenCalledWith('chat-1');
  });

  it('长列表仅渲染虚拟窗口并在接近底部时加载下一页', () => {
    const onLoadMore = vi.fn();
    const manyConversations = Array.from({ length: 100 }, (_, index) => ({
      id: `chat-${index}`,
      title: `会话 ${index}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    render(
      <Sidebar
        conversations={manyConversations}
        activeChatId={null}
        open={false}
        onClose={vi.fn()}
        onNewChat={vi.fn()}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );

    expect(screen.getAllByLabelText(/^管理聊天：/).length).toBeLessThan(100);
    expect(screen.queryByText('会话 99')).not.toBeInTheDocument();
    const list = screen.getByRole('navigation', { name: '历史聊天' });
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 4432 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 480 });
    Object.defineProperty(list, 'scrollTop', { configurable: true, value: 3920 });
    fireEvent.scroll(list);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});

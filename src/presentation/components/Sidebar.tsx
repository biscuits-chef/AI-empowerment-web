import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { groupConversationsByActivity } from '../../application/conversationGrouping';
import type { Conversation } from '../../domain/models';

/**
 * 会话侧栏显示与交互属性。
 */
type SidebarProps = {
  /**
   * 会话列表。
   */
  conversations: Conversation[];
  /**
   * 当前选中会话 ID。
   */
  activeChatId: string | null;
  /**
   * 侧栏是否展开。
   */
  open: boolean;
  /**
   * 关闭回调。
   */
  onClose: () => void;
  /**
   * 新建会话回调。
   */
  onNewChat: () => void;
  /**
   * 会话选择回调。
   *
   * @param chatId 会话 ID。
   */
  onSelect: (chatId: string) => void;
  /**
   * 会话改名回调。
   *
   * @param chatId 会话 ID。
   *
   * @param title 会话名称。
   */
  onRename: (chatId: string, title: string) => void;
  /**
   * 会话删除回调。
   *
   * @param chatId 会话 ID。
   */
  onDelete: (chatId: string) => void;
  /** 是否还有下一页会话。 */
  hasMore?: boolean;
  /** 是否正在加载下一页会话。 */
  loadingMore?: boolean;
  /** 触发下一页会话加载。 */
  onLoadMore?: () => void;
};

/** 会话分组标题固定高度。 */
const GROUP_HEADER_HEIGHT = 32;
/** 会话行固定高度。 */
const CONVERSATION_ROW_HEIGHT = 44;
/** 虚拟列表默认可视高度。 */
const DEFAULT_VIEWPORT_HEIGHT = 480;
/** 虚拟列表上下额外渲染像素。 */
const VIRTUAL_OVERSCAN = 88;

/** 会话标题每秒水平移动的像素数。 */
const TITLE_SCROLL_PIXELS_PER_SECOND = 30;
/** 短标题滚动的最小时长，避免较短溢出内容移动过快。 */
const MINIMUM_TITLE_SCROLL_MILLISECONDS = 4000;

/**
 * 会话标题滚动动画使用的 CSS 自定义属性。
 */
type ConversationTitleAnimationStyle = CSSProperties & {
  /** 标题向左移动的负偏移量。 */
  '--conversation-title-offset': string;
  /** 标题匀速移动到末尾所需时长。 */
  '--conversation-title-duration': string;
};

/**
 * 会话标题展示属性。
 */
type ConversationTitleProps = {
  /** 完整会话标题。 */
  title: string;
};

/**
 * 单行展示会话标题，并在标题被截断时支持悬停滚动查看剩余内容。
 *
 * @param 参数1 解构后的标题属性，各字段含义见对应属性类型。
 * @returns 可滚动的会话标题。
 */
const ConversationTitle = ({ title }: ConversationTitleProps) => {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [animationStyle, setAnimationStyle] = useState<ConversationTitleAnimationStyle | null>(
    null,
  );

  /**
   * 根据真实溢出距离准备可读的匀速标题滚动动画。
   */
  const startTitleScroll = (): void => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) return;
    const distance = Math.ceil(text.scrollWidth - viewport.clientWidth);
    if (distance <= 0) return;
    const duration = Math.max(
      MINIMUM_TITLE_SCROLL_MILLISECONDS,
      Math.ceil((distance / TITLE_SCROLL_PIXELS_PER_SECOND) * 1000),
    );
    setAnimationStyle({
      '--conversation-title-offset': `-${distance}px`,
      '--conversation-title-duration': `${duration}ms`,
    });
  };

  /**
   * 鼠标离开后移除动画并把标题恢复到开头。
   */
  const stopTitleScroll = (): void => setAnimationStyle(null);

  return (
    <span
      className={`conversation-item__title ${animationStyle ? 'is-scrolling' : ''}`}
      ref={viewportRef}
      title={title}
      style={animationStyle ?? undefined}
      onMouseEnter={startTitleScroll}
      onMouseLeave={stopTitleScroll}
    >
      <span className="conversation-item__title-text" ref={textRef}>
        {title}
      </span>
    </span>
  );
};

/**
 * 虚拟会话列表中的单行布局信息。
 */
type VirtualConversationRow =
  | {
      /** 分组标题行。 */
      kind: 'group';
      /** 稳定行标识。 */
      key: string;
      /** 中文分组标题。 */
      label: string;
      /** 行顶部偏移。 */
      top: number;
      /** 行高度。 */
      height: number;
    }
  | {
      /** 会话数据行。 */
      kind: 'conversation';
      /** 稳定行标识。 */
      key: string;
      /** 会话领域对象。 */
      conversation: Conversation;
      /** 行顶部偏移。 */
      top: number;
      /** 行高度。 */
      height: number;
    };

/**
 * 把时间分组转换为具有固定偏移的虚拟行。
 *
 * @param conversations 已按后端稳定顺序排列的会话。
 * @returns 分组标题与会话组成的虚拟行。
 */
const virtualRows = (conversations: Conversation[]): VirtualConversationRow[] => {
  const rows: VirtualConversationRow[] = [];
  let top = 0;
  for (const group of groupConversationsByActivity(conversations)) {
    rows.push({
      kind: 'group',
      key: `group-${group.key}`,
      label: group.label,
      top,
      height: GROUP_HEADER_HEIGHT,
    });
    top += GROUP_HEADER_HEIGHT;
    for (const conversation of group.conversations) {
      rows.push({
        kind: 'conversation',
        key: conversation.id,
        conversation,
        top,
        height: CONVERSATION_ROW_HEIGHT,
      });
      top += CONVERSATION_ROW_HEIGHT;
    }
  }
  return rows;
};

/**
 * 当前会话管理对话框的类型与目标会话。
 */
type ConversationDialogState =
  | {
      /**
       * 对话框类型。
       */
      kind: 'rename';
      /**
       * 目标会话。
       */
      conversation: Conversation;
    }
  | {
      /**
       * 对话框类型。
       */
      kind: 'delete';
      /**
       * 目标会话。
       */
      conversation: Conversation;
    };

/**
 * 展示会话搜索、切换、改名和删除操作。
 *
 * @param 参数1 解构后的组件属性，各字段含义见对应属性类型。
 *
 * @returns 函数处理结果。
 */
export const Sidebar = ({
  conversations,
  activeChatId,
  open,
  onClose,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
  hasMore = false,
  loadingMore = false,
  onLoadMore = () => undefined,
}: SidebarProps) => {
  const [query, setQuery] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ConversationDialogState | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const openMenuRef = useRef<HTMLDivElement>(null);
  const dialogElementRef = useRef<HTMLDialogElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);
  const filtered = useMemo(
    () => conversations.filter(({ title }) => title.toLowerCase().includes(query.toLowerCase())),
    [conversations, query],
  );
  const rows = useMemo(() => virtualRows(filtered), [filtered]);
  const totalHeight =
    rows.length === 0 ? 0 : rows[rows.length - 1]!.top + rows[rows.length - 1]!.height;
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.top + row.height >= scrollTop - VIRTUAL_OVERSCAN &&
          row.top <= scrollTop + viewportHeight + VIRTUAL_OVERSCAN,
      ),
    [rows, scrollTop, viewportHeight],
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    /** 根据实际容器高度更新虚拟列表可视窗口。 */
    const updateHeight = (): void =>
      setViewportHeight(list.clientHeight || DEFAULT_VIEWPORT_HEIGHT);
    updateHeight();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  /**
   * 更新搜索条件并同步复位虚拟列表位置。
   *
   * @param value 新的搜索关键字。
   */
  const changeQuery = (value: string): void => {
    setQuery(value);
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  /**
   * 更新虚拟窗口并在接近底部时请求下一页。
   *
   * @param event 会话列表滚动事件。
   */
  const handleListScroll = (event: React.UIEvent<HTMLElement>): void => {
    const element = event.currentTarget;
    setScrollTop(element.scrollTop);
    if (
      hasMore &&
      !loadingMore &&
      element.scrollHeight - element.scrollTop - element.clientHeight < CONVERSATION_ROW_HEIGHT * 3
    ) {
      onLoadMore();
    }
  };

  /**
   * 打开修改名称对话框并预填当前名称。
   *
   * @param conversation 会话领域对象。
   */
  const openRenameDialog = (conversation: Conversation): void => {
    setMenuId(null);
    setRenameTitle(conversation.title);
    setDialog({ kind: 'rename', conversation });
  };

  /**
   * 打开删除确认对话框。
   *
   * @param conversation 会话领域对象。
   */
  const openDeleteDialog = (conversation: Conversation): void => {
    setMenuId(null);
    setDialog({ kind: 'delete', conversation });
  };

  /**
   * 关闭当前会话管理对话框。
   */
  const closeDialog = (): void => setDialog(null);

  /**
   * 提交去除首尾空白后的会话名称。
   *
   * @param event 表单提交事件。
   */
  const submitRename = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const title = renameTitle.trim();
    if (!title || dialog?.kind !== 'rename') return;
    onRename(dialog.conversation.id, title);
    closeDialog();
  };

  useEffect(() => {
    if (!menuId) return undefined;
    /**
     * 点击当前菜单及其触发按钮之外的区域时关闭菜单。
     *
     * @param event 指针按下事件。
     */
    const closeMenuOnOutsidePointer = (event: PointerEvent): void => {
      if (!openMenuRef.current?.contains(event.target as Node)) setMenuId(null);
    };
    /**
     * 按下 Esc 时关闭当前菜单。
     *
     * @param event 键盘事件。
     */
    const closeMenuOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuId(null);
    };
    document.addEventListener('pointerdown', closeMenuOnOutsidePointer);
    document.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsidePointer);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [menuId]);

  useEffect(() => {
    if (!dialog) return undefined;
    const dialogElement = dialogElementRef.current;
    if (!dialogElement) return undefined;

    // 原生 showModal 会把对话框提升到浏览器 top layer，从根本上避开页面堆叠上下文覆盖。
    if (!dialogElement.open) {
      if (typeof dialogElement.showModal === 'function') dialogElement.showModal();
      else dialogElement.setAttribute('open', '');
    }
    if (dialog.kind === 'rename') renameInputRef.current?.focus();
    return () => {
      if (!dialogElement.open) return;
      if (typeof dialogElement.close === 'function') dialogElement.close();
      else dialogElement.removeAttribute('open');
    };
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return undefined;
    /**
     * 按下 Esc 时关闭当前对话框。
     *
     * @param event 键盘事件。
     */
    const closeDialogOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeDialog();
    };
    document.addEventListener('keydown', closeDialogOnEscape);
    return () => document.removeEventListener('keydown', closeDialogOnEscape);
  }, [dialog]);

  return (
    <>
      {open && <button className="sidebar-backdrop" aria-label="关闭侧边栏" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`} aria-label="聊天记录">
        <div className="sidebar__brand">
          <div className="brand-mark" aria-hidden="true">
            智
          </div>
          <span className="sidebar__brand-copy">
            <strong>智浦小鹿</strong>
            <small>企业 AI 智能工作台</small>
          </span>
          <button className="icon-button sidebar__close" aria-label="关闭侧边栏" onClick={onClose}>
            <PanelLeftClose size={18} />
          </button>
        </div>

        <button className="new-chat-button" onClick={onNewChat}>
          <Plus size={18} />
          新建会话
        </button>

        <label className="sidebar-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">搜索聊天</span>
          <input
            type="search"
            value={query}
            placeholder="搜索聊天"
            onChange={(event) => changeQuery(event.target.value)}
          />
        </label>

        <nav
          className="conversation-list"
          aria-label="历史聊天"
          ref={listRef}
          onScroll={handleListScroll}
        >
          <div className="conversation-virtual-space" style={{ height: totalHeight }}>
            {visibleRows.map((row) =>
              row.kind === 'group' ? (
                <p
                  className="conversation-list__label conversation-virtual-row"
                  key={row.key}
                  role="heading"
                  aria-level={2}
                  style={{ height: row.height, transform: `translateY(${row.top}px)` }}
                >
                  {row.label}
                </p>
              ) : (
                <div
                  className={`conversation-item ${
                    activeChatId === row.conversation.id ? 'is-active' : ''
                  }`}
                  key={row.key}
                  ref={menuId === row.conversation.id ? openMenuRef : undefined}
                  style={{ height: row.height, transform: `translateY(${row.top}px)` }}
                >
                  <button
                    className="conversation-item__select"
                    onClick={() => onSelect(row.conversation.id)}
                  >
                    <MessageSquare
                      className="conversation-item__icon"
                      size={18}
                      aria-hidden="true"
                    />
                    <ConversationTitle title={row.conversation.title} />
                  </button>
                  <button
                    className="icon-button conversation-item__more"
                    aria-label={`管理聊天：${row.conversation.title}`}
                    aria-expanded={menuId === row.conversation.id}
                    aria-haspopup="menu"
                    onClick={() =>
                      setMenuId(menuId === row.conversation.id ? null : row.conversation.id)
                    }
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {menuId === row.conversation.id && (
                    <div className="conversation-menu" role="menu">
                      <button role="menuitem" onClick={() => openRenameDialog(row.conversation)}>
                        <Pencil size={15} /> 修改名称
                      </button>
                      <button
                        className="danger"
                        role="menuitem"
                        onClick={() => openDeleteDialog(row.conversation)}
                      >
                        <Trash2 size={15} /> 删除
                      </button>
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
          {loadingMore && (
            <p className="sidebar-loading" role="status">
              正在加载更多聊天
            </p>
          )}
          {filtered.length === 0 && <p className="sidebar-empty">没有匹配的聊天</p>}
        </nav>

        <div className="sidebar__footer">
          <div className="user-avatar" aria-hidden="true">
            内
          </div>
          <div>
            <strong>公司内部用户</strong>
            <span>企业知识助手</span>
          </div>
        </div>
      </aside>

      {dialog && (
        <dialog
          ref={dialogElementRef}
          className="conversation-dialog-layer"
          role={dialog.kind === 'rename' ? 'dialog' : 'alertdialog'}
          aria-modal="true"
          aria-labelledby={dialog.kind === 'rename' ? 'rename-dialog-title' : 'delete-dialog-title'}
          aria-describedby={dialog.kind === 'delete' ? 'delete-dialog-description' : undefined}
          onCancel={(event) => {
            event.preventDefault();
            closeDialog();
          }}
        >
          <button
            className="conversation-dialog-backdrop"
            data-testid="conversation-dialog-backdrop"
            aria-label="关闭会话操作对话框"
            tabIndex={-1}
            onClick={closeDialog}
          />
          {dialog.kind === 'rename' ? (
            <div className="conversation-dialog">
              <h2 id="rename-dialog-title">修改聊天名称</h2>
              <form onSubmit={submitRename}>
                <label htmlFor="conversation-title">聊天名称</label>
                <input
                  ref={renameInputRef}
                  id="conversation-title"
                  autoFocus
                  maxLength={100}
                  value={renameTitle}
                  onChange={(event) => setRenameTitle(event.target.value)}
                />
                <div className="conversation-dialog__actions">
                  <button type="button" onClick={closeDialog}>
                    取消
                  </button>
                  <button type="submit" className="primary" disabled={!renameTitle.trim()}>
                    保存名称
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="conversation-dialog">
              <h2 id="delete-dialog-title">删除聊天</h2>
              <p id="delete-dialog-description">
                确定删除“{dialog.conversation.title}”吗？删除后不可恢复。
              </p>
              <div className="conversation-dialog__actions">
                <button type="button" onClick={closeDialog}>
                  取消删除
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    onDelete(dialog.conversation.id);
                    closeDialog();
                  }}
                >
                  确认删除
                </button>
              </div>
            </div>
          )}
        </dialog>
      )}
    </>
  );
};

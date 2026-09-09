import type {
  Conversation,
  ConversationPage,
  DisplayMessage,
  Feedback,
  HistoricalExecutionEvent,
} from '../../domain/models';

/**
 * 会话页面的可序列化状态。
 */
export type ChatState = {
  /**
   * 会话列表。
   */
  conversations: Conversation[];
  /** 下一页会话游标。 */
  nextConversationCursor: string | null;
  /** 是否还有更多会话。 */
  hasMoreConversations: boolean;
  /** 是否正在加载下一页会话。 */
  loadingMoreConversations: boolean;
  /**
   * 当前选中会话 ID。
   */
  activeChatId: string | null;
  /**
   * 消息列表。
   */
  messages: DisplayMessage[];
  /**
   * 页面是否正在加载。
   */
  loading: boolean;
  /**
   * 是否正在提交或生成回答。
   */
  sending: boolean;
  /**
   * 异常对象。
   */
  error: string | null;
};

export const initialChatState: ChatState = {
  conversations: [],
  nextConversationCursor: null,
  hasMoreConversations: false,
  loadingMoreConversations: false,
  activeChatId: null,
  messages: [],
  loading: true,
  sending: false,
  error: null,
};

/**
 * 会话页面状态转换动作。
 */
export type ChatAction =
  | {
      /**
       * 事件或实体类型。
       */
      type: 'loaded';
      /** 首页面会话。 */
      page: ConversationPage;
    }
  | {
      /** 事件或实体类型。 */
      type: 'moreConversationsLoaded';
      /** 下一页会话。 */
      page: ConversationPage;
    }
  | {
      /** 事件或实体类型。 */
      type: 'loadingMoreConversations';
      /** 是否正在加载下一页会话。 */
      value: boolean;
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'selecting';
      /**
       * 会话 ID。
       */
      chatId: string | null;
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'messagesLoaded';
      /**
       * 消息列表。
       */
      messages: DisplayMessage[];
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'conversationAdded';
      /**
       * 会话领域对象。
       */
      conversation: Conversation;
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'conversationUpdated';
      /**
       * 会话领域对象。
       */
      conversation: Conversation;
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'conversationDeleted';
      /**
       * 会话 ID。
       */
      chatId: string;
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'messageAdded';
      /**
       * 消息。
       */
      message: DisplayMessage;
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'messagePatched';
      /**
       * 唯一标识。
       */
      id: string;
      /**
       * 需要合并到消息上的局部字段。
       */
      patch: Partial<DisplayMessage>;
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'delta';
      /**
       * 唯一标识。
       */
      id: string;
      /**
       * 输入值。
       */
      value: string;
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'citation';
      /**
       * 唯一标识。
       */
      id: string;
      /**
       * 单条证据来源。
       */
      citation: string;
    }
  | {
      /** 事件或实体类型。 */
      type: 'executionEvent';
      /** 回答消息唯一标识。 */
      id: string;
      /** 需要追加的持久化执行事件。 */
      event: HistoricalExecutionEvent;
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'feedback';
      /**
       * 唯一标识。
       */
      id: string;
      /**
       * 用户反馈。
       */
      feedback: Feedback;
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'sending';
      /**
       * 输入值。
       */
      value: boolean;
    }
  | {
      /**
       * 事件或实体类型。
       */
      type: 'error';
      /**
       * 消息。
       */
      message: string | null;
    };

/**
 * 将更新后的会话移到列表首位。
 *
 * @param conversations 会话列表。
 *
 * @param updated 更新后的会话摘要。
 *
 * @returns 函数处理结果。
 */
const replaceConversation = (
  conversations: Conversation[],
  updated: Conversation,
): Conversation[] => [updated, ...conversations.filter(({ id }) => id !== updated.id)];

/**
 * 以纯函数方式归并流式增量和用户操作，避免组件之间直接共享可变状态。
 *
 * @param state 当前会话状态。
 *
 * @param action 状态变更动作。
 *
 * @returns 函数处理结果。
 */
export const chatReducer = (state: ChatState, action: ChatAction): ChatState => {
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        conversations: action.page.items,
        nextConversationCursor: action.page.nextCursor,
        hasMoreConversations: action.page.hasMore,
        loading: false,
      };
    case 'moreConversationsLoaded': {
      const known = new Set(state.conversations.map(({ id }) => id));
      return {
        ...state,
        conversations: [
          ...state.conversations,
          ...action.page.items.filter(({ id }) => !known.has(id)),
        ],
        nextConversationCursor: action.page.nextCursor,
        hasMoreConversations: action.page.hasMore,
        loadingMoreConversations: false,
      };
    }
    case 'loadingMoreConversations':
      return { ...state, loadingMoreConversations: action.value };
    case 'selecting':
      return {
        ...state,
        activeChatId: action.chatId,
        messages: [],
        loading: action.chatId !== null,
        error: null,
      };
    case 'messagesLoaded':
      return { ...state, messages: action.messages, loading: false };
    case 'conversationAdded':
    case 'conversationUpdated':
      return {
        ...state,
        conversations: replaceConversation(state.conversations, action.conversation),
      };
    case 'conversationDeleted':
      return {
        ...state,
        conversations: state.conversations.filter(({ id }) => id !== action.chatId),
        activeChatId: state.activeChatId === action.chatId ? null : state.activeChatId,
        messages: state.activeChatId === action.chatId ? [] : state.messages,
      };
    case 'messageAdded':
      return { ...state, messages: [...state.messages, action.message] };
    case 'messagePatched':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id ? { ...message, ...action.patch } : message,
        ),
      };
    case 'delta':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id
            ? { ...message, content: message.content + action.value }
            : message,
        ),
      };
    case 'citation':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id && !message.citations?.includes(action.citation)
            ? { ...message, citations: [...(message.citations ?? []), action.citation] }
            : message,
        ),
      };
    case 'executionEvent':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id &&
          !message.executionEvents?.some(({ sequence }) => sequence === action.event.sequence)
            ? {
                ...message,
                executionEvents: [...(message.executionEvents ?? []), action.event],
              }
            : message,
        ),
      };
    case 'feedback':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.id ? { ...message, feedback: action.feedback } : message,
        ),
      };
    case 'sending':
      return { ...state, sending: action.value };
    case 'error':
      return { ...state, error: action.message, loading: false, sending: false };
  }
};

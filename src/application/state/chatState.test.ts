import { describe, expect, it } from 'vitest';
import type { Conversation, DisplayMessage } from '../../domain/models';
import { chatReducer, initialChatState } from './chatState';

const conversation: Conversation = {
  id: 'chat-1',
  title: '产品问答',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const answer: DisplayMessage = {
  id: 'answer-1',
  answerId: 'answer-1',
  role: 'ASSISTANT',
  content: '',
  createdAt: '2026-01-01',
};

describe('chatReducer', () => {
  it('管理会话生命周期', () => {
    let state = chatReducer(initialChatState, {
      type: 'loaded',
      page: { items: [], nextCursor: null, hasMore: false },
    });
    state = chatReducer(state, { type: 'conversationAdded', conversation });
    state = chatReducer(state, { type: 'selecting', chatId: conversation.id });
    state = chatReducer(state, {
      type: 'conversationUpdated',
      conversation: { ...conversation, title: '新名称' },
    });
    expect(state.activeChatId).toBe('chat-1');
    expect(state.conversations[0]?.title).toBe('新名称');
    state = chatReducer(state, { type: 'conversationDeleted', chatId: 'chat-1' });
    expect(state.activeChatId).toBeNull();
  });

  it('累加回答、来源并去重', () => {
    let state = chatReducer(initialChatState, { type: 'messageAdded', message: answer });
    state = chatReducer(state, { type: 'delta', id: answer.id, value: '第一段' });
    state = chatReducer(state, { type: 'delta', id: answer.id, value: '第二段' });
    state = chatReducer(state, { type: 'citation', id: answer.id, citation: 'doc-1' });
    state = chatReducer(state, { type: 'citation', id: answer.id, citation: 'doc-1' });
    expect(state.messages[0]).toMatchObject({
      content: '第一段第二段',
      citations: ['doc-1'],
    });
  });

  it('更新反馈、消息属性和错误状态', () => {
    let state = chatReducer(initialChatState, { type: 'messagesLoaded', messages: [answer] });
    state = chatReducer(state, { type: 'feedback', id: answer.id, feedback: 'LIKE' });
    state = chatReducer(state, {
      type: 'messagePatched',
      id: answer.id,
      patch: { answerStatus: 'COMPLETED' },
    });
    state = chatReducer(state, { type: 'sending', value: true });
    state = chatReducer(state, { type: 'error', message: '失败' });
    expect(state.messages[0]).toMatchObject({ feedback: 'LIKE', answerStatus: 'COMPLETED' });
    expect(state).toMatchObject({ sending: false, error: '失败' });
  });
});

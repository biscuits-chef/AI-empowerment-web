import { describe, expect, it } from 'vitest';
import type { Conversation } from '../domain/models';
import { groupConversationsByActivity } from './conversationGrouping';

/**
 * 创建用于时间分组测试的会话。
 *
 * @param id 会话 ID 与标题。
 * @param updatedAt 最后活动时间。
 * @returns 测试会话。
 */
const conversation = (id: string, updatedAt: string): Conversation => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
});

describe('groupConversationsByActivity', () => {
  it('跨年时仍按本地自然日识别昨天', () => {
    const now = new Date(2027, 0, 1, 12);
    const yesterday = new Date(2026, 11, 31, 23).toISOString();

    const groups = groupConversationsByActivity([conversation('跨年会话', yesterday)], now);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('昨天');
  });

  it('把无效活动时间安全归入更早且不丢失会话', () => {
    const groups = groupConversationsByActivity(
      [conversation('时间异常会话', 'invalid-time')],
      new Date(2026, 8, 2, 12),
    );

    expect(groups[0]?.label).toBe('更早');
    expect(groups[0]?.conversations[0]?.id).toBe('时间异常会话');
  });
});

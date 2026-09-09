import type { Conversation } from '../domain/models';

/**
 * 会话活动时间分组。
 */
export type ConversationGroup = {
  /** 稳定分组标识。 */
  key: 'today' | 'yesterday' | 'earlier';
  /** 用户可见的中文分组名称。 */
  label: '今天' | '昨天' | '更早';
  /** 属于该时间区间的会话。 */
  conversations: Conversation[];
};

/**
 * 按浏览器本地自然日把会话划分为今天、昨天和更早。
 *
 * @param conversations 待分组的会话列表。
 * @param now 用于判断自然日边界的当前时间。
 * @returns 保持原列表顺序且仅包含非空项的会话分组。
 */
export const groupConversationsByActivity = (
  conversations: Conversation[],
  now: Date = new Date(),
): ConversationGroup[] => {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const groups: ConversationGroup[] = [
    { key: 'today', label: '今天', conversations: [] },
    { key: 'yesterday', label: '昨天', conversations: [] },
    { key: 'earlier', label: '更早', conversations: [] },
  ];
  for (const conversation of conversations) {
    const activityTime = new Date(conversation.updatedAt).getTime();
    if (Number.isFinite(activityTime) && activityTime >= todayStart) {
      groups[0]!.conversations.push(conversation);
    } else if (Number.isFinite(activityTime) && activityTime >= yesterdayStart) {
      groups[1]!.conversations.push(conversation);
    } else {
      // 无效时间按“更早”安全降级，避免会话因脏数据从侧栏消失。
      groups[2]!.conversations.push(conversation);
    }
  }
  return groups.filter((group) => group.conversations.length > 0);
};

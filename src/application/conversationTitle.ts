/** 会话默认标题允许保留的最大字符数，与后端会话名称约束一致。 */
export const MAXIMUM_CONVERSATION_TITLE_CHARACTERS = 100;

/**
 * 使用首次有效提问生成会话默认标题。
 *
 * @param question 用户首次有效提问。
 * @returns 去除首尾空白并截取前一百个字符的会话标题。
 */
export const conversationTitleFromFirstQuestion = (question: string): string =>
  question.trim().slice(0, MAXIMUM_CONVERSATION_TITLE_CHARACTERS);

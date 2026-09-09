import { describe, expect, it } from 'vitest';
import {
  conversationTitleFromFirstQuestion,
  MAXIMUM_CONVERSATION_TITLE_CHARACTERS,
} from './conversationTitle';

describe('conversationTitleFromFirstQuestion', () => {
  it('使用首次提问前一百个字符生成默认标题', () => {
    const question = `  ${'产'.repeat(105)}  `;

    const title = conversationTitleFromFirstQuestion(question);

    expect(title).toBe('产'.repeat(100));
    expect(title).toHaveLength(MAXIMUM_CONVERSATION_TITLE_CHARACTERS);
  });

  it('保留不足一百个字符的完整首次提问', () => {
    expect(conversationTitleFromFirstQuestion('  查询悦享一号的产品经理  ')).toBe(
      '查询悦享一号的产品经理',
    );
  });
});

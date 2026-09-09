import type { AnswerStreamEvent, StreamEventType } from '../../domain/models';

/**
 * 尚在累积的 SSE 原始事件字段。
 */
type SseRecord = {
  /**
   * 唯一标识。
   */
  id?: string;
  /**
   * 回答流事件。
   */
  event?: string;
  /**
   * 一个 SSE 事件的多行数据内容。
   */
  data: string[];
};

/**
 * 把完整 SSE 记录转换为有序回答事件。
 *
 * @param record 当前正在累积的 SSE 事件记录。
 *
 * @returns 函数处理结果。
 */
const toAnswerEvent = (record: SseRecord): AnswerStreamEvent | null => {
  if (!record.event || !record.id) return null;
  const id = Number(record.id);
  if (!Number.isSafeInteger(id) || id < 0) return null;
  let payload: {
    /**
     * 输入值。
     */
    value?: unknown;
    /**
     * 事件发生时间。
     */
    occurredAt?: unknown;
  };
  try {
    payload = JSON.parse(record.data.join('\n')) as typeof payload;
  } catch {
    return null;
  }
  return {
    id,
    type: record.event as StreamEventType,
    value: typeof payload.value === 'string' ? payload.value : '',
    occurredAt: typeof payload.occurredAt === 'string' ? payload.occurredAt : undefined,
  };
};

/**
 * 增量解析可能跨网络分片的 SSE 文本，只输出结构完整且序号有效的事件。
 */
export class SseParser {
  /**
   * 尚未拼成完整数据行的文本缓存。
   */
  private buffer = '';
  /**
   * 当前正在累积的 SSE 事件记录。
   */
  private record: SseRecord = { data: [] };

  /**
   * 缓存网络分片并输出完整事件。
   *
   * @param chunk 本次接收的文本分片。
   *
   * @returns 函数处理结果。
   */
  push(chunk: string): AnswerStreamEvent[] {
    this.buffer += chunk.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.flatMap((line) => this.consumeLine(line));
  }

  /**
   * 提交流结束时剩余的完整事件。
   *
   * @returns 函数处理结果。
   */
  finish(): AnswerStreamEvent[] {
    const events = this.buffer ? this.consumeLine(this.buffer) : [];
    this.buffer = '';
    return [...events, ...this.consumeLine('')];
  }

  /**
   * 将一行 SSE 文本归入当前事件。
   *
   * @param line 待解析的 SSE 数据行。
   *
   * @returns 函数处理结果。
   */
  private consumeLine(line: string): AnswerStreamEvent[] {
    if (line === '') {
      const event = toAnswerEvent(this.record);
      this.record = { data: [] };
      return event ? [event] : [];
    }
    if (line.startsWith(':')) return [];
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'id') this.record.id = value;
    if (field === 'event') this.record.event = value;
    if (field === 'data') this.record.data.push(value);
    return [];
  }
}

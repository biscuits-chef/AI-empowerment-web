import { describe, expect, it } from 'vitest';
import { SseParser } from './sseParser';

describe('SseParser', () => {
  it('支持跨分片、CRLF 和多行 data', () => {
    const parser = new SseParser();
    expect(parser.push('id: 1\r\nevent: del')).toEqual([]);
    expect(
      parser.push('ta\r\ndata: {"value":"你好",\r\ndata: "occurredAt":"2026-01-01"}\r\n\r\n'),
    ).toEqual([{ id: 1, type: 'delta', value: '你好', occurredAt: '2026-01-01' }]);
  });

  it('忽略注释和无效事件', () => {
    const parser = new SseParser();
    expect(parser.push(': heartbeat\n\ndata: nope\n\n')).toEqual([]);
    expect(parser.push('id: invalid\nevent: delta\ndata: {}\n\n')).toEqual([]);
  });

  it('在流结束时提交最后一个事件', () => {
    const parser = new SseParser();
    parser.push('id: 2\nevent: completed\ndata: {"value":"stop"}');
    expect(parser.finish()).toEqual([
      { id: 2, type: 'completed', value: 'stop', occurredAt: undefined },
    ]);
  });
});

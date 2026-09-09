import { describe, expect, it } from 'vitest';
import type { HistoricalExecutionEvent, StreamEventType } from '../domain/models';
import { buildExecutionTimeline, formatExecutionDuration } from './executionTimeline';

/**
 * 创建固定时间递增的执行事件。
 *
 * @param sequence 事件序号。
 * @param type 事件类型。
 * @param value 事件值。
 * @returns 固定时间的测试事件。
 */
const event = (
  sequence: number,
  type: StreamEventType,
  value: string,
): HistoricalExecutionEvent => ({
  sequence,
  type,
  value,
  occurredAt: `2026-09-08T08:00:${String(sequence).padStart(2, '0')}.000Z`,
});

describe('executionTimeline', () => {
  it('将完整双通道事件转换为五阶段安全摘要和耗时', () => {
    const timeline = buildExecutionTimeline(
      [
        event(1, 'workflow_plan_selected', 'DUAL_CHANNEL_QA|1'),
        event(2, 'intent_recognition_started', 'STARTED'),
        event(3, 'intent_recognized', 'PRODUCT_MANAGER_QUERY|96|1'),
        event(4, 'retrieval_started', 'STARTED'),
        event(5, 'citation', 'doc-1'),
        event(6, 'knowledge_retrieval_completed', '1'),
        event(7, 'business_query_started', 'STARTED'),
        event(8, 'business_query_completed', '2'),
        event(9, 'evidence_reconciliation_started', 'STARTED'),
        event(10, 'evidence_assessed', 'CONSISTENT|0'),
        event(11, 'generation_started', 'STARTED'),
        event(12, 'generation_completed', 'READY_TO_PERSIST'),
        event(13, 'completed', 'stop'),
      ],
      'COMPLETED',
    );

    expect(timeline).toMatchObject({
      scenario: '智能问数 · 双通道核验',
      planVersion: '1',
      settledSteps: 5,
      totalSteps: 5,
    });
    expect(timeline.steps.map(({ status }) => status)).toEqual([
      'SUCCEEDED',
      'SUCCEEDED',
      'SUCCEEDED',
      'SUCCEEDED',
      'SUCCEEDED',
    ]);
    expect(timeline.steps[0]?.detail).toContain('查询产品经理');
    expect(timeline.steps[0]?.detail).toContain('96%');
    expect(timeline.steps[1]?.detail).toContain('1 个授权片段');
    expect(timeline.steps[2]?.detail).toContain('2 条结构化业务事实');
    expect(timeline.steps[3]?.detail).toContain('双通道证据一致');
    expect(timeline.steps[0]?.durationMs).toBe(1000);
  });

  it('在追问时停止下游阶段并明确显示需关注', () => {
    const timeline = buildExecutionTimeline(
      [
        event(1, 'workflow_plan_selected', 'DUAL_CHANNEL_QA|1'),
        event(2, 'intent_recognition_started', 'STARTED'),
        event(3, 'clarification_required', 'REFERENCE_NOT_FOUND'),
        event(4, 'completed', 'clarification_required'),
      ],
      'NEEDS_CLARIFICATION',
    );

    expect(timeline.steps[0]?.status).toBe('ATTENTION');
    expect(timeline.steps[0]?.detail).toContain('未继续访问数据源');
    expect(timeline.steps.slice(1).every(({ status }) => status === 'WAITING')).toBe(true);
  });

  it('在查询失败和用户停止时标记最后活动阶段', () => {
    const failed = buildExecutionTimeline(
      [event(1, 'retrieval_started', 'STARTED'), event(2, 'error', 'KNOWLEDGE_TIMEOUT')],
      'FAILED',
    );
    const cancelled = buildExecutionTimeline(
      [event(1, 'generation_started', 'STARTED'), event(2, 'cancelled', 'USER_REQUESTED')],
      'CANCELLED',
    );

    expect(failed.steps[1]?.status).toBe('FAILED');
    expect(cancelled.steps[4]?.status).toBe('CANCELLED');
  });

  it('兼容旧历史事件并安全处理无效耗时', () => {
    const timeline = buildExecutionTimeline(
      [
        event(1, 'intent_recognition_started', 'STARTED'),
        event(2, 'intent_recognized', 'PRODUCT_TRADE_BASIC_INFO'),
        event(3, 'retrieval_started', 'STARTED'),
        event(4, 'business_query_started', 'STARTED'),
      ],
      'QUERYING',
    );

    expect(timeline.steps[1]?.status).toBe('SUCCEEDED');
    expect(timeline.steps[2]?.status).toBe('RUNNING');
    expect(formatExecutionDuration(undefined)).toBeUndefined();
    expect(formatExecutionDuration(25)).toBe('25 毫秒');
    expect(formatExecutionDuration(1250)).toBe('1.3 秒');
  });
});

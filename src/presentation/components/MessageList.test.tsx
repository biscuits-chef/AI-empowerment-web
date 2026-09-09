import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DisplayMessage } from '../../domain/models';
import { MessageList } from './MessageList';

const completed: DisplayMessage = {
  id: 'answer-1',
  answerId: 'answer-1',
  role: 'ASSISTANT',
  content: '这是已完成回答',
  createdAt: '2026-01-01',
  answerStatus: 'COMPLETED',
  citations: ['知识库文档'],
  needsManualReview: true,
};

afterEach(() => vi.restoreAllMocks());

describe('MessageList', () => {
  it('严格模式下滚动实现返回异步值也不会造成页面崩溃', () => {
    const scrollIntoView = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockReturnValue(Promise.resolve() as unknown as void);

    const { unmount } = render(
      <StrictMode>
        <MessageList
          messages={[completed]}
          onStop={vi.fn()}
          onFeedback={vi.fn()}
          onRegenerate={vi.fn()}
        />
      </StrictMode>,
    );

    expect(screen.getByText('这是已完成回答')).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('支持已完成答案的全部操作', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    const onFeedback = vi.fn();
    const onRegenerate = vi.fn();
    render(
      <MessageList
        messages={[completed]}
        onStop={vi.fn()}
        onFeedback={onFeedback}
        onRegenerate={onRegenerate}
      />,
    );
    expect(screen.getByText('需要人工复核')).toBeInTheDocument();
    expect(screen.getByText('来源与产物（1）')).toBeInTheDocument();
    await user.click(screen.getByLabelText('复制回答'));
    expect(writeText).toHaveBeenCalledWith('这是已完成回答');
    await user.click(screen.getByLabelText('喜欢这个回答'));
    await user.click(screen.getByLabelText('不喜欢这个回答'));
    await user.click(screen.getByLabelText('重新生成回答'));
    expect(onFeedback).toHaveBeenNthCalledWith(1, 'answer-1', 'LIKE');
    expect(onFeedback).toHaveBeenNthCalledWith(2, 'answer-1', 'DISLIKE');
    expect(onRegenerate).toHaveBeenCalledWith('answer-1');
  });

  it('生成中允许停止并展示错误', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(
      <MessageList
        messages={[
          {
            ...completed,
            answerStatus: 'GENERATING',
            stageLabel: '正在组织回答',
            errorMessage: '暂时失败',
          },
        ]}
        onStop={onStop}
        onFeedback={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    await user.click(screen.getByText('停止生成'));
    expect(onStop).toHaveBeenCalledWith('answer-1');
    expect(screen.getByText('暂时失败')).toBeInTheDocument();
  });

  it('以五阶段白盒时间线展示流程版本、结果数量、耗时和安全边界', async () => {
    const user = userEvent.setup();
    render(
      <MessageList
        messages={[
          {
            ...completed,
            traceId: 'trace-safe-001',
            executionEvents: [
              {
                sequence: 1,
                type: 'workflow_plan_selected',
                value: 'DUAL_CHANNEL_QA|1',
                occurredAt: '2026-09-08T08:00:01.000Z',
              },
              {
                sequence: 2,
                type: 'intent_recognition_started',
                value: 'STARTED',
                occurredAt: '2026-09-08T08:00:02.000Z',
              },
              {
                sequence: 3,
                type: 'intent_recognized',
                value: 'PRODUCT_MANAGER_QUERY|98|1',
                occurredAt: '2026-09-08T08:00:03.000Z',
              },
              {
                sequence: 4,
                type: 'retrieval_started',
                value: 'STARTED',
                occurredAt: '2026-09-08T08:00:04.000Z',
              },
              {
                sequence: 5,
                type: 'knowledge_retrieval_completed',
                value: '2',
                occurredAt: '2026-09-08T08:00:06.000Z',
              },
            ],
          },
        ]}
        onStop={vi.fn()}
        onFeedback={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    await user.click(screen.getByText('执行过程'));
    expect(screen.getByText('智能问数 · 双通道核验')).toBeInTheDocument();
    expect(screen.getByText('流程版本 v1')).toBeInTheDocument();
    expect(screen.getByText('运行编号 trace-safe-001')).toBeInTheDocument();
    expect(screen.getByText(/查询产品经理；识别置信度 98%/)).toBeInTheDocument();
    expect(screen.getByText(/知识库返回 2 个授权片段/)).toBeInTheDocument();
    expect(screen.getByText(/不展示内部提示词、原始 SQL/)).toBeInTheDocument();
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
  });

  it('在用户消息中展示附件元数据和过期状态', () => {
    render(
      <MessageList
        messages={[
          {
            id: 'question-1',
            role: 'USER',
            content: '查询文件中的产品',
            createdAt: '2026-01-01',
            attachments: [
              {
                fileId: 'file-1',
                name: '产品清单.xlsx',
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                sizeBytes: 2048,
                usage: 'QUERY_INPUT',
                status: 'DELETE_PENDING',
              },
            ],
          },
        ]}
        onStop={vi.fn()}
        onFeedback={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    expect(screen.getByRole('list', { name: '本次提问附件' })).toBeInTheDocument();
    expect(screen.getByText('产品清单.xlsx')).toBeInTheDocument();
    expect(screen.getByText(/2.0 KB · 查询条件/)).toBeInTheDocument();
    expect(screen.getByText('文件已过期')).toBeInTheDocument();
  });
});

import type { AnswerStatus, HistoricalExecutionEvent, StreamEventType } from '../domain/models';

/** 用户可见的执行阶段状态。 */
export type ExecutionStepStatus =
  'WAITING' | 'RUNNING' | 'SUCCEEDED' | 'ATTENTION' | 'FAILED' | 'CANCELLED';

/** 白盒执行时间线中的单个业务阶段。 */
export type ExecutionStep = {
  /** 阶段稳定标识。 */
  id: 'UNDERSTANDING' | 'KNOWLEDGE' | 'DATABASE' | 'RECONCILIATION' | 'GENERATION';
  /** 用户可理解的阶段名称。 */
  title: string;
  /** 该阶段的职责说明。 */
  description: string;
  /** 当前阶段状态。 */
  status: ExecutionStepStatus;
  /** 本阶段产生的安全摘要，不包含提示词、SQL 或业务正文。 */
  detail: string;
  /** 阶段开始时间。 */
  startedAt?: string;
  /** 阶段结束时间。 */
  completedAt?: string;
  /** 阶段耗时毫秒数。 */
  durationMs?: number;
};

/** 一次回答的白盒执行概要。 */
export type ExecutionTimeline = {
  /** 用户可理解的场景名称。 */
  scenario: string;
  /** 后端选定的执行计划版本。 */
  planVersion?: string;
  /** 已完成或已终止的阶段数量。 */
  settledSteps: number;
  /** 总阶段数量。 */
  totalSteps: number;
  /** 按实际执行顺序排列的阶段。 */
  steps: ExecutionStep[];
};

/** 构建阶段时使用的事件映射定义。 */
type StepDefinition = {
  /** 阶段稳定标识。 */
  id: ExecutionStep['id'];
  /** 用户可理解的阶段名称。 */
  title: string;
  /** 该阶段的职责说明。 */
  description: string;
  /** 标识阶段开始的事件。 */
  startTypes: StreamEventType[];
  /** 标识阶段结束的事件。 */
  endTypes: StreamEventType[];
};

/** 双通道问答固定业务阶段定义。 */
const STEP_DEFINITIONS: StepDefinition[] = [
  {
    id: 'UNDERSTANDING',
    title: '理解问题',
    description: '识别意图、提取查询条件并结合上下文消解指代。',
    startTypes: ['intent_recognition_started'],
    endTypes: ['intent_recognized', 'clarification_required'],
  },
  {
    id: 'KNOWLEDGE',
    title: '查询公司知识库',
    description: '使用已解析的问题检索当前用户有权访问的知识片段。',
    startTypes: ['retrieval_started'],
    endTypes: ['knowledge_retrieval_completed'],
  },
  {
    id: 'DATABASE',
    title: '查询业务数据库',
    description: '通过受控查询计划访问 GoldenDB，不执行大模型自由生成的 SQL。',
    startTypes: ['business_query_started'],
    endTypes: ['business_query_completed'],
  },
  {
    id: 'RECONCILIATION',
    title: '核验双通道证据',
    description: '比较知识库与业务数据库结果，识别一致、冲突或证据不足。',
    startTypes: ['evidence_reconciliation_started'],
    endTypes: ['evidence_assessed', 'manual_review_required'],
  },
  {
    id: 'GENERATION',
    title: '生成并保存回答',
    description: '仅根据已取得的证据组织回答，并将正常结果持久化。',
    startTypes: ['generation_started'],
    endTypes: ['generation_completed', 'completed'],
  },
];

/** 查询意图稳定编码对应的用户文案。 */
const INTENT_LABELS: Record<string, string> = {
  PRODUCT_INVESTMENT_MANAGER_QUERY: '查询产品投资经理（双口径）',
  PRODUCT_MANAGER_QUERY: '查询产品经理',
  PRODUCT_REFERENCE_DATE_LIST_QUERY: '查询基准日及到期日产品',
  PRODUCT_TRADE_BASIC_INFO: '查询产品或交易基础信息',
  PRODUCT_LATEST_DOCUMENT_INFO: '查询产品最新文档信息',
  UNSUPPORTED: '当前范围外的问题',
};

/**
 * 返回事件列表中首个指定类型的事件。
 *
 * @param events 有序执行事件。
 * @param types 允许匹配的事件类型。
 * @returns 首个匹配事件；不存在时返回 undefined。
 */
const firstEvent = (
  events: HistoricalExecutionEvent[],
  types: StreamEventType[],
): HistoricalExecutionEvent | undefined => events.find((event) => types.includes(event.type));

/**
 * 返回事件列表中最后一个指定类型的事件。
 *
 * @param events 有序执行事件。
 * @param types 允许匹配的事件类型。
 * @returns 最后一个匹配事件；不存在时返回 undefined。
 */
const lastEvent = (
  events: HistoricalExecutionEvent[],
  types: StreamEventType[],
): HistoricalExecutionEvent | undefined =>
  [...events].reverse().find((event) => types.includes(event.type));

/**
 * 将不可信计数字符串转换为非负整数。
 *
 * @param value 服务端计数字符串。
 * @returns 合法非负整数；无效值返回零。
 */
const safeCount = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

/**
 * 构建意图识别阶段的安全结果摘要。
 *
 * @param events 有序执行事件。
 * @returns 不含原始问题和内部推理的摘要。
 */
const understandingDetail = (events: HistoricalExecutionEvent[]): string => {
  const clarification = firstEvent(events, ['clarification_required']);
  if (clarification) return '查询条件尚不完整，系统已发起确定性追问，未继续访问数据源。';
  const recognized = firstEvent(events, ['intent_recognized']);
  if (!recognized) return '等待完成意图与查询条件识别。';
  const [intent = '', confidence = '', entityCount = '0'] = recognized.value.split('|');
  const intentLabel = INTENT_LABELS[intent] ?? '已识别业务查询意图';
  const confidenceValue = safeCount(confidence);
  return `${intentLabel}；识别置信度 ${confidenceValue}%；确认 ${safeCount(entityCount)} 个查询条件。`;
};

/**
 * 构建知识库检索阶段的安全结果摘要。
 *
 * @param events 有序执行事件。
 * @returns 只包含片段和来源数量的摘要。
 */
const knowledgeDetail = (events: HistoricalExecutionEvent[]): string => {
  const completed = firstEvent(events, ['knowledge_retrieval_completed']);
  if (!completed) return '等待公司知识库返回授权范围内的检索结果。';
  const citations = events.filter(({ type }) => type === 'citation').length;
  return `知识库返回 ${safeCount(completed.value)} 个授权片段，关联 ${citations} 个可追溯来源。`;
};

/**
 * 构建业务数据库查询阶段的安全结果摘要。
 *
 * @param events 有序执行事件。
 * @returns 只包含结构化事实数量的摘要。
 */
const databaseDetail = (events: HistoricalExecutionEvent[]): string => {
  const completed = firstEvent(events, ['business_query_completed']);
  if (!completed) return '等待受控查询计划执行并返回结构化数据。';
  return `GoldenDB 返回 ${safeCount(completed.value)} 条结构化业务事实。`;
};

/**
 * 构建双通道证据核验阶段的安全结果摘要。
 *
 * @param events 有序执行事件。
 * @returns 一致、冲突或证据不足摘要。
 */
const reconciliationDetail = (events: HistoricalExecutionEvent[]): string => {
  const assessed = firstEvent(events, ['evidence_assessed']);
  if (!assessed) return '等待比较两个通道的证据范围和关键字段。';
  const [status = '', conflictCount = '0'] = assessed.value.split('|');
  if (status === 'CONSISTENT') return '双通道证据一致，可继续生成回答。';
  if (status === 'CONFLICT') {
    return `发现 ${safeCount(conflictCount)} 个冲突字段，两个通道的信息都会保留并提示人工复核。`;
  }
  return '当前证据不足，系统将明确拒绝猜测。';
};

/**
 * 构建回答生成阶段的安全结果摘要。
 *
 * @param events 有序执行事件。
 * @param status 当前回答状态。
 * @returns 生成、持久化、停止或失败摘要。
 */
const generationDetail = (events: HistoricalExecutionEvent[], status?: AnswerStatus): string => {
  if (status === 'CANCELLED') return '用户已停止生成，已经持久化的部分内容继续保留。';
  if (status === 'FAILED' || status === 'INCOMPLETE') return '回答未完整生成，可使用运行编号排查。';
  if (firstEvent(events, ['completed'])) return '回答已完成并保存，可在刷新后恢复。';
  if (firstEvent(events, ['generation_completed'])) return '回答内容已生成并进入持久化确认。';
  return '等待公司大模型根据已核验的证据组织回答。';
};

/**
 * 根据阶段标识生成当前阶段结果摘要。
 *
 * @param id 阶段稳定标识。
 * @param events 有序执行事件。
 * @param status 当前回答状态。
 * @returns 对应阶段的安全摘要。
 */
const stepDetail = (
  id: ExecutionStep['id'],
  events: HistoricalExecutionEvent[],
  status?: AnswerStatus,
): string => {
  if (id === 'UNDERSTANDING') return understandingDetail(events);
  if (id === 'KNOWLEDGE') return knowledgeDetail(events);
  if (id === 'DATABASE') return databaseDetail(events);
  if (id === 'RECONCILIATION') return reconciliationDetail(events);
  return generationDetail(events, status);
};

/**
 * 判断回答终态是否表示执行失败。
 *
 * @param status 当前回答状态。
 * @returns 失败、不完整或停止失败时返回 true。
 */
const failedStatus = (status?: AnswerStatus): boolean =>
  status === 'FAILED' || status === 'INCOMPLETE' || status === 'CANCEL_FAILED';

/**
 * 计算阶段开始与结束事件之间的非负耗时。
 *
 * @param started 阶段开始事件。
 * @param completed 阶段结束事件。
 * @returns 非负毫秒耗时；时间无效时返回 undefined。
 */
const durationBetween = (
  started?: HistoricalExecutionEvent,
  completed?: HistoricalExecutionEvent,
): number | undefined => {
  if (!started || !completed) return undefined;
  const duration = Date.parse(completed.occurredAt) - Date.parse(started.occurredAt);
  return Number.isFinite(duration) ? Math.max(0, duration) : undefined;
};

/**
 * 把持久化执行事件转换为用户可理解的五阶段白盒时间线。
 *
 * @param events 服务端返回的有序执行事件。
 * @param answerStatus 当前回答状态。
 * @returns 可直接展示且不含敏感内部载荷的执行时间线。
 */
export const buildExecutionTimeline = (
  events: HistoricalExecutionEvent[],
  answerStatus?: AnswerStatus,
): ExecutionTimeline => {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const plan = firstEvent(ordered, ['workflow_plan_selected']);
  const [scenarioCode = '', planVersion] = plan?.value.split('|') ?? [];
  const lastStartedIndex = STEP_DEFINITIONS.reduce(
    (latest, definition, index) =>
      firstEvent(ordered, definition.startTypes) ? Math.max(latest, index) : latest,
    -1,
  );
  const terminalEvent = lastEvent(ordered, [
    'completed',
    'cancelled',
    'cancellation_failed',
    'error',
  ]);
  const steps = STEP_DEFINITIONS.map((definition, index): ExecutionStep => {
    const started = firstEvent(ordered, definition.startTypes);
    const completed = lastEvent(ordered, definition.endTypes);
    let status: ExecutionStepStatus = 'WAITING';
    if (started && completed) status = 'SUCCEEDED';
    else if (started && index < lastStartedIndex) status = 'SUCCEEDED';
    else if (started) status = 'RUNNING';
    if (definition.id === 'UNDERSTANDING' && firstEvent(ordered, ['clarification_required'])) {
      status = 'ATTENTION';
    }
    if (definition.id === 'RECONCILIATION' && firstEvent(ordered, ['manual_review_required'])) {
      status = 'ATTENTION';
    }
    if (started && index === lastStartedIndex && terminalEvent && failedStatus(answerStatus)) {
      status = 'FAILED';
    }
    if (started && index === lastStartedIndex && answerStatus === 'CANCELLED') {
      status = 'CANCELLED';
    }
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      status,
      detail: stepDetail(definition.id, ordered, answerStatus),
      startedAt: started?.occurredAt,
      completedAt: completed?.occurredAt,
      durationMs: durationBetween(started, completed),
    };
  });
  return {
    scenario: scenarioCode === 'DUAL_CHANNEL_QA' ? '智能问数 · 双通道核验' : '智能问数',
    planVersion,
    settledSteps: steps.filter(({ status }) => status !== 'WAITING' && status !== 'RUNNING').length,
    totalSteps: steps.length,
    steps,
  };
};

/**
 * 将毫秒耗时格式化为简短中文文本。
 *
 * @param durationMs 阶段耗时毫秒数。
 * @returns 小于一秒或保留一位小数的秒数。
 */
export const formatExecutionDuration = (durationMs?: number): string | undefined => {
  if (durationMs === undefined) return undefined;
  if (durationMs < 1000) return `${durationMs} 毫秒`;
  return `${(durationMs / 1000).toFixed(1)} 秒`;
};

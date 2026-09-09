import type { AgentDefinition, AgentType } from '../../domain/models';

/** 前端本地维护的 Agent 目录；一期只开放智能问数。 */
export const AGENT_CATALOG: readonly AgentDefinition[] = [
  {
    id: 'SMART_DATA',
    name: '智能问数',
    description: '查询并核验知识库与业务数据',
    available: true,
  },
  {
    id: 'SMART_QA',
    name: '智能问答',
    description: '面向公司知识的通用问答',
    available: false,
    unavailableMessage: '该功能尚未开放',
  },
  {
    id: 'CONTRACT_REVIEW',
    name: '合同智能审核',
    description: '根据规则集执行合同合规与风险检查',
    available: false,
    unavailableMessage: '该功能尚未开放',
  },
  {
    id: 'CONTRACT_COMPARE',
    name: '合同差异比对',
    description: '比对业务合同与标准模板',
    available: false,
    unavailableMessage: '该功能尚未开放',
  },
  {
    id: 'CONFIRMATION_CHECK',
    name: '申赎确认单处理',
    description: '识别版面并提取申赎确认单字段',
    available: false,
    unavailableMessage: '该功能尚未开放',
  },
];

/** 一期默认选中的 Agent 类型。 */
export const DEFAULT_AGENT_TYPE: AgentType = 'SMART_DATA';

/**
 * 按稳定类型查找前端配置的 Agent。
 *
 * @param agentType Agent 类型。
 * @returns 匹配的 Agent 定义；配置不存在时返回空。
 */
export const findAgent = (agentType: AgentType): AgentDefinition | undefined =>
  AGENT_CATALOG.find(({ id }) => id === agentType);

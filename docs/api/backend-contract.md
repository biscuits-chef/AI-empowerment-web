# 后端接口契约基线

基准服务：`intelligent-qa-audit-service`。前缀为 `/api/v1`，所有请求使用已认证的同源用户身份。

## 聊天

- 不提供 `GET /agents`；Agent 目录由前端本地配置。首次 `POST /questions/submission` 必须携带 `agentType=SMART_DATA`，后端独立校验并固化到会话；已有会话后续请求省略该字段，后端按会话类型路由且禁止切换。
- `GET /chats?cursor=...&limit=30`：稳定游标聊天列表，响应为 `items`、`nextCursor` 和 `hasMore`；首页不传游标。
- `GET /chats/{chatId}/messages?limit=100`：历史消息；助手消息包含真实 `answerStatus`，追问为 `NEEDS_CLARIFICATION`。为兼容开发期旧数据，用户消息可能只读返回历史附件元数据。

历史 `attachments` 元素包含 `fileId`、`name`、`contentType`、`sizeBytes`、`usage` 和 `status`，仅用于兼容展示，不代表一期支持上传。接口不得返回对象键、OBS URL、本地路径或文件内容。

- `POST /chats/{chatId}/rename`：修改名称。
- `POST /chats/{chatId}/deletion`：删除聊天。存在活动回答时返回 `409`、`title=Conversation is active` 和固定说明“会话正在执行，请停止后删除”。

新聊天由前端保持为空白草稿，第一次有效提问时只调用一次统一提交接口，由后端原子创建会话、问题和回答。后端删除保护是最终约束，前端不得依赖本地状态绕过，也不得收到冲突后自动停止回答。

## 问答

- `POST /questions/submission`：统一提交问题，必须携带 `Idempotency-Key`。首次请求体为 `{"chatId":null,"agentType":"SMART_DATA","question":"..."}`；后续请求体为 `{"chatId":"已有会话 ID","question":"..."}`，不得由前端重复选择或修改 Agent。响应为 `{"conversation":{...},"conversationCreated":true|false,"answer":{...}}`。第一阶段携带非空 `files` 时返回 `400`。
- `GET /answers/{answerId}`：读取持久化答案快照。
- `GET /answers/{answerId}/events`：读取流事件，重连时携带 `Last-Event-ID`。
- `POST /answers/{answerId}/regenerations`：把原问题作为新问答轮次重新发起，必须携带幂等键。响应包含新的 `questionId` 和 `answerId`，`regeneratedFromAnswerId` 指向原回答。
- `POST /answers/{answerId}/cancellation`：停止生成，请求体为 `{"reason":"USER_REQUESTED"}`，必须携带幂等键。
- `POST /answers/{answerId}/feedback`：反馈，请求体为 `{"feedback":"LIKE"}` 或 `DISLIKE`。

## 临时附件（后续阶段）

第一阶段不注册上传、列表和删除接口。相关路径及字段待后续阶段重新冻结，不属于当前前后端契约。

前端业务接口只使用 GET 和 POST。GET 只读取数据；创建、修改、删除、反馈、停止和重新生成等状态变更全部使用 POST，客户端不得发送 PUT、PATCH、DELETE 或其他 HTTP 方法。每项操作必须使用唯一 URL，不得让 GET 与 POST 共享路径后再依靠方法区分。

## 流事件

事件包括元数据、流程计划、意图识别、追问、知识检索、业务查询、证据核验、人工复核、生成、增量文本、取消、完成和错误。事件数据格式为：

```json
{ "value": "事件值", "occurredAt": "时间" }
```

白盒阶段事件包括：`workflow_plan_selected` 的值为 `场景|流程版本`；`intent_recognized` 的值为 `意图|置信度百分数|查询条件数量`；`knowledge_retrieval_completed` 和 `business_query_completed` 的值为非负结果数量；`evidence_reconciliation_started` 表示开始核验；`evidence_assessed` 的值为 `CONSISTENT|CONFLICT|INSUFFICIENT` 加冲突字段数量；`generation_completed` 表示内容生成完成但仍需等待最终 `completed` 持久化确认。这些事件不得包含提示词、思维链、原始 SQL、服务地址、密钥或证据正文。

追问事件序列为 `clarification_required → delta → completed(value=clarification_required)`，最终状态为 `NEEDS_CLARIFICATION`。用户通过下一条普通问题回复候选序号、名称或唯一标识；追问回答不展示赞踩和重新生成操作。

终态事件为 `completed`、`cancelled`、`error` 和 `cancellation_failed`；`completed` 的值为 `clarification_required` 时不得改写成普通 `COMPLETED`。历史助手消息同时返回 `executionEvents` 和 `artifacts`，分别用于恢复执行阶段/人工复核与来源产物。重放区间失效返回 409，前端必须读取答案快照恢复，禁止静默显示残缺答案。

## 待扩展契约

当前引用事件只包含来源标识，无法完整展示两个通道的结构化字段和值。上线结构化冲突对照前，需要后端提供来源类型、字段、值、文档版本、业务时间和可展示标题。

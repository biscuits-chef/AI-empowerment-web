# 后端接口契约基线

基准服务：`intelligent-qa-audit-service`。前缀为 `/api/v1`，所有请求使用已认证的同源用户身份。

## 聊天

- 不提供 `GET /agents`；Agent 目录由前端本地配置。`POST /chats/{chatId}/questions` 请求体必须携带 `agentType`，一期固定为 `SMART_DATA`；后端独立校验并路由。
- `POST /chats`：创建聊天，请求体为 `{"title":"..."}`。
- `GET /chats?cursor=...&limit=30`：稳定游标聊天列表，响应为 `items`、`nextCursor` 和 `hasMore`；首页不传游标。
- `GET /chats/{chatId}/messages?limit=100`：历史消息；助手消息包含真实 `answerStatus`，追问为 `NEEDS_CLARIFICATION`。用户消息通过 `attachments` 返回随该次问题提交的附件元数据。

`attachments` 元素包含 `fileId`、`name`、`contentType`、`sizeBytes`、`usage` 和 `status`。`usage` 是该次问题固化的用途；`status` 可能为 `DELETE_PENDING`，此时前端保留卡片并提示“文件已过期”。接口不得返回对象键、OBS URL、本地路径或文件内容。无附件消息返回空列表；兼容旧响应时前端也接受字段缺省。

- `PATCH /chats/{chatId}`：修改名称。
- `DELETE /chats/{chatId}`：删除聊天。存在活动回答时返回 `409`、`title=Conversation is active` 和固定说明“会话正在执行，请停止后删除”。

新聊天由前端保持为空白草稿，第一次有效提问时先创建会话、再提交问题。后端删除保护是最终约束，前端不得依赖本地状态绕过，也不得收到冲突后自动停止回答。

## 问答

- `POST /chats/{chatId}/questions`：提交问题，必须携带 `Idempotency-Key`，请求体为 `{"question":"...","files":[{"fileId":"...","usage":"AUTO|QUERY_INPUT|EVIDENCE"}]}`。
- `GET /answers/{answerId}`：读取持久化答案快照。
- `GET /answers/{answerId}/events`：读取流事件，重连时携带 `Last-Event-ID`。
- `POST /answers/{answerId}/regenerations`：把原问题作为新问答轮次重新发起，必须携带幂等键。响应包含新的 `questionId` 和 `answerId`，`regeneratedFromAnswerId` 指向原回答；历史消息将新增原问题用户消息和新助手消息，原附件引用随新问题复制。
- `POST /answers/{answerId}/cancellation`：停止生成，请求体为 `{"reason":"USER_REQUESTED"}`，必须携带幂等键。
- `PUT /answers/{answerId}/feedback`：反馈，请求体为 `{"feedback":"LIKE"}` 或 `DISLIKE`。

## 临时附件

- `POST /chats/{chatId}/files`：使用 `multipart/form-data` 上传，字段为 `file` 和 `usage`，必须携带 `Idempotency-Key`。
- `GET /chats/{chatId}/files`：查询当前用户、当前会话的活动附件。
- `DELETE /chats/{chatId}/files/{fileId}`：逻辑删除附件并触发对象清理。
- 当前开发环境完成基础类型、文件头、大小和归属校验后返回 `READY`；测试和生产未接入安全扫描、解析/OCR 与真实 OBS 时只返回 `STORED` 或失败关闭。
- 错误状态：`409` 文件未就绪或幂等冲突，`413` 超过 1 MiB，`415` 类型或文件头不受支持。

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

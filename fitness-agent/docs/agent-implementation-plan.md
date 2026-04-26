# Agent Phase 1 实施方案

## 1. 目标

Phase 1 的目标不是把 Agent 做成一个“全自动多智能体系统”，而是先把当前仓库收成一套可信、可审计、可持续扩展的执行基座。第一期要解决的核心问题有四个：

- 身份可信：前端、Agent、Backend 统一使用 Bearer token，不再信任可伪造的 `x-user-id`
- 执行可信：所有写操作都经过“提案 -> 确认 -> 单次执行 -> 终态”链路
- 上下文可信：执行前必须校验 proposal 仍然匹配生成时的计划上下文，避免 stale proposal 覆盖新数据
- 工程可信：Agent runtime、前端卡片、后端契约和执行记录都可恢复、可审计、可继续扩展

## 2. 范围

Phase 1 允许 Agent 通过提案加确认的方式执行以下写操作：

- 生成训练计划
- 调整当前 active plan
- 新增、修改、删除、完成 `WorkoutPlanDay`
- 写入 `BodyMetricLog`
- 写入 `DailyCheckin`
- 写入 `WorkoutLog`

Phase 1 不开放以下对象给 Agent 直接写入：

- `User`
- `HealthProfile`
- `DietRecommendationSnapshot`
- exercise catalog
- 系统配置或任意自由写入能力

## 3. 架构原则

### 3.1 Backend 是唯一写库入口

Agent 永远不直接访问 Prisma 或 PostgreSQL。所有真实写操作都必须经过 NestJS controller/service，再由 Backend 负责：

- 身份校验
- 参数校验
- 幂等控制
- stale proposal 校验
- 审计记录
- 数据一致性

### 3.2 Agent 负责编排，不直接执行高风险写操作

当前 Agent 采用单运行时 orchestrator，不引入重型多智能体框架。运行时内部职责拆分为：

- intent detection
- context loading
- proposal drafting
- proposal validation
- result rendering

Agent 只负责理解请求、读取上下文、生成结构化提案、展示确认结果，不再负责直接拼装任意写请求。

### 3.3 Proposal 必须经过单次确认执行

Proposal 生命周期固定为：

- `pending`
- `approved`
- `executed`
- `rejected`
- `failed`
- `expired`

约束如下：

- 只有 `pending` proposal 可以被确认
- 只有 `approved` proposal 可以被执行
- 已 `executed` proposal 不允许再次执行
- 已 `rejected` / `expired` / `failed` proposal 不允许回到可执行状态
- 每次执行都要记录 execution 结果，并在 proposal 上留下终态时间

## 4. 核心数据流

### 4.1 读路径

1. 用户在前端 chat 输入请求
2. 前端使用 Bearer token 请求 Agent
3. Agent 读取 Backend 上下文
4. Agent 返回普通回复或结构化 proposal card

### 4.2 写路径

1. 用户在 chat 中发起写操作请求
2. Agent 读取必要上下文，例如当前 active plan
3. Agent 生成结构化 proposal，并持久化到 Backend
4. 前端展示 proposal card
5. 用户点击确认
6. Agent 调用 Backend confirm 接口
7. Backend 原子完成状态跃迁、stale 校验、执行、审计落库
8. Agent 写回执行结果消息
9. 前端刷新消息和相关业务页面

## 5. 鉴权与身份边界

### 5.1 Token 方案

Backend `auth` 接口签发真实 access token，token 内至少包含：

- `sub`
- `email`
- `name`
- `iat`
- `exp`

### 5.2 前端策略

前端本地只保存：

- `AuthSession`
- access token

前端不再把 `userId` cookie 当成可信身份来源。`readAuthUserId()` 只允许作为 UI 辅助能力存在，不能参与后端权限判断。

### 5.3 Backend 策略

所有业务接口统一从 `Authorization: Bearer <token>` 中解析当前用户，不再接受 `x-user-id` 作为生产鉴权方式。

## 6. Proposal 与执行语义

### 6.1 Proposal 持久化

Proposal 至少要保存：

- 基本动作信息：`actionType`、`entityType`、`entityId`
- 用户可读信息：`title`、`summary`、`preview`
- 机器可执行信息：`payload`
- 风险信息：`riskLevel`、`requiresConfirmation`
- 生命周期信息：`status`、`expiresAt`、`executedAt`
- 上下文基线：`basePlanId`、`basePlanVersion`、`basePlanUpdatedAt`
- 目标基线：`expectedDayId`、`expectedDayUpdatedAt`

### 6.2 Execution 持久化

每次执行都要保存：

- `proposalId`
- `userId`
- `idempotencyKey`
- `status`
- `requestPayload`
- `resultPayload`
- `errorMessage`

### 6.3 单次执行约束

即使用户重复点击确认，也不能触发第二次写库。Proposal 级别必须拦截二次执行，而不是只依赖 execution 的幂等键。

## 7. Stale Proposal 校验

对计划类 proposal，执行前至少要校验以下条件：

- active plan 仍然是 proposal 生成时的 `basePlanId`
- active plan 的 `version` 或 `updatedAt` 没有变化
- 目标 `WorkoutPlanDay` 仍然存在
- 目标 day 仍然属于当前 active plan
- 目标 day 的 `updatedAt` 没有被其他操作改动

如果任一条件不满足：

- 拒绝执行
- proposal 进入失败或 stale 终态
- 前端明确提示“提案已过期，请重新生成”

## 8. 前端交互要求

### 8.1 Chat 卡片

Chat 中保留两类卡片：

- `action_proposal_card`
- `action_result_card`

Proposal card 至少展示：

- 标题
- 摘要
- 变更预览
- 风险等级
- 当前状态

### 8.2 按钮状态

- `pending`：允许确认和拒绝
- `approved` / `executing`：禁用重复点击
- `executed` / `rejected` / `failed` / `expired`：只读展示

### 8.3 刷新恢复

页面刷新后必须基于后端消息和 proposal 状态恢复界面，不能依赖本地 optimistic 结果伪造状态。

## 9. 工程实现建议

### 9.1 Agent

- 保留单运行时
- 文案常量尽量集中管理
- 结构化 proposal 的字段定义保持稳定
- 只保留白名单 action type

### 9.2 Backend

- 将鉴权收敛到统一 guard
- 将 proposal 状态机和执行语义收敛到 `AgentStateService`
- command 层只做命令路由，不承载模糊业务推断

### 9.3 Frontend

- API client 统一注入 Bearer token
- server component 和 client component 使用同一套 token 语义
- proposal/result card 的 UI 状态直接映射后端状态

## 10. 最小测试要求

Phase 1 至少应覆盖以下验证：

- 登录后可用 Bearer token 访问 `/me`、`/plans/current`、agent 相关接口
- 伪造 `x-user-id` 不再能越权
- `pending` proposal 只能执行一次
- `executed` proposal 不能再次执行
- stale proposal 在 active plan 变化后会被正确拦截
- chat 页刷新后 proposal/result 状态可以恢复
- 前端 chat/card 文案无乱码
- backend build、frontend build、agent Python 编译检查全部通过

## 11. 为 Phase 2 预留的扩展点

Phase 1 不引入多智能体，但要为后续扩展保留接口：

- proposal group / coaching package
- 周复盘和日建议工作流
- 聚合上下文读取接口
- 更丰富的 advice / diet / review snapshot

也就是说，Phase 1 的重点是把“可信身份 + 单次确认执行 + stale 校验 + 状态恢复”做好，让后续闭环教练系统建立在一个稳定地基上，而不是继续在 demo 级链路上叠功能。

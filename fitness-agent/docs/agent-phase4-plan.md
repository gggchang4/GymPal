# Agent 四期规划：产品化主动闭环教练系统

## 1. 文档目的

本文档定义 `fitness-agent` 在 Phase 1 “可信执行基座”、Phase 2 “闭环教练与复盘执行架构”、Phase 3 “长期个性化、效果评估与策略演进”之后的四期演进方案。

Phase 4 的目标不是继续堆更多写库动作，而是把当前 Agent 从“能安全生成建议、能记忆用户、能评估效果”的智能模块，升级为一个更接近真实产品可用形态的主动闭环教练系统。

一句话目标：

> Phase 1 解决安全执行，Phase 2 解决周期闭环，Phase 3 解决长期个性化，Phase 4 解决产品化主动闭环与实际使用体验。

Phase 4 默认延续以下底线：

- Backend 仍然是唯一写库入口
- 高影响写入仍然必须 proposal / package + 用户确认
- Agent 仍然保持单 FastAPI runtime，不引入分布式多 Agent 运行时
- 不做医疗诊断，不把推断包装成医学事实
- 不做站外 push、短信、邮件等外部通知
- 不引入强化学习或不可解释策略优化

## 2. 前置条件

Phase 4 默认建立在以下能力已经稳定完成的前提上：

- Bearer token 鉴权已经统一到前端、Agent、Backend
- 单动作 proposal 与 coaching package 已支持确认、拒绝、执行、失败、过期和幂等控制
- `coach-summary` 已能聚合计划、日志、饮食、建议、pending package、memory 和 recent outcome
- `UserCoachingMemory` 已能保存长期偏好与约束，并能被用户归档
- `CoachingOutcome` 已能评估 package 后续效果
- `CoachingStrategyTemplate` 已能记录策略版本
- Agent 输出已经支持 evidence-first 卡片、memory candidate 卡片、outcome summary 卡片和 strategy decision 卡片
- Chat 与 Dashboard 已能恢复 review / package / outcome / memory 状态

如果上述能力尚未稳定，不建议提前实现 Phase 4。Phase 4 会引入主动生成待办、质量门和产品工作台，如果基础状态机或跨账号隔离不稳，会放大用户侧混乱感。

## 3. 四期总体目标

Phase 4 聚焦四件事：

- 将 Dashboard 升级为“教练工作台”，成为用户每天打开产品时的主入口
- 让 Agent 主动生成待确认事项，而不是只在用户聊天或点击按钮时被动响应
- 建立 planner -> evaluator -> reviser 的质量闭环，减少不安全、不完整、不适配的建议
- 建立产品级可观测性，让建议为什么出现、为什么被降级、为什么不能执行都可追踪

Phase 4 的核心产品体验是：

1. 用户进入 Dashboard
2. 系统读取 workspace summary
3. Agent 主动检查是否需要周复盘、今日建议、补日志、刷新 outcome、处理记忆候选
4. 系统生成 `AgentWorkItem`
5. 用户在教练工作台处理待办
6. 高影响动作仍通过 proposal / package 确认后执行
7. 执行后的 outcome、feedback、memory 继续进入下一轮建议

也就是说，Phase 4 的闭环不再只发生在 chat 内，而是变成整个产品的默认运行方式。

## 4. 架构边界

### 4.1 允许的主动性

Phase 4 允许 Agent 主动生成以下内容：

- 待确认周复盘
- 待确认今日建议
- 待补日志提醒
- 待确认记忆候选
- 待刷新 outcome
- 待处理 pending package 提示
- 基于负反馈的重新修订建议

这些主动项以 `AgentWorkItem` 形式保存，默认只是产品内待办或只读提醒。

### 4.2 仍然禁止的自动化

Phase 4 不允许：

- 自动执行训练计划重写
- 自动生成并落库饮食快照
- 自动写入长期记忆
- 自动修改 `User` / `HealthProfile`
- 自动医疗判断
- 自动站外通知
- 用户未确认时自动应用 coaching package

低风险 work item 可以自动创建，但高影响写动作仍然必须进入 Phase 1/2/3 已有的确认执行链路。

### 4.3 单运行时内部分层

Phase 4 仍然保持单 Agent runtime，但内部建议进一步模块化：

- `context_reader`
  - 读取 workspace summary、coach summary、memory summary、recent outcome
- `planner`
  - 生成候选建议、work item 或 package 草案
- `evaluator`
  - 检查数据充分性、安全、策略一致性、记忆冲突、用户反馈
- `reviser`
  - 将风险过高或依据不足的方案降级为保守方案
- `renderer`
  - 输出稳定卡片和用户可理解的解释

这是一种单运行时内的职责分层，不是多进程或分布式多 Agent。

## 5. 数据模型建议

### 5.1 新增 `AgentWorkItem`

用于保存产品内待处理的 Agent 工作项。

建议字段：

- `id`
- `userId`
- `type`
  - `weekly_review_due`
  - `daily_guidance_due`
  - `log_gap`
  - `pending_package`
  - `memory_candidate`
  - `outcome_refresh_due`
  - `revision_suggested`
- `status`
  - `pending`
  - `opened`
  - `dismissed`
  - `converted`
  - `expired`
- `priority`
  - `low`
  - `medium`
  - `high`
- `source`
  - `dashboard_refresh`
  - `scheduled_check`
  - `chat`
  - `outcome`
  - `feedback`
- `title`
- `summary`
- `reason`
- `payload` JSON
- `relatedThreadId`
- `relatedReviewId`
- `relatedProposalGroupId`
- `relatedOutcomeId`
- `convertedEntityType`
- `convertedEntityId`
- `expiresAt`
- `createdAt`
- `updatedAt`

约束建议：

- 同一用户、同一 `type`、同一关联对象，在 `pending/opened` 状态下只能存在一条
- work item 只能影响当前用户
- work item 过期后不能再转换为 package
- `converted` 状态必须记录转换后的 review / proposal / package 目标
- `payload` 只保存生成待办所需的结构化摘要和实体引用，避免保存大段原始 chat 或完整健康数据快照

状态流转建议：

| 当前状态 | 允许流转 | 说明 |
| --- | --- | --- |
| `pending` | `opened` / `dismissed` / `converted` / `expired` | 初始可处理状态 |
| `opened` | `dismissed` / `converted` / `expired` | 已查看但仍可处理 |
| `dismissed` | 无 | 用户明确忽略后的终态 |
| `converted` | 无 | 已转换为 review / proposal / package 后的终态 |
| `expired` | 无 | 过期后的终态，只能只读展示 |

并发与幂等建议：

- `refresh`、后台轻量检查和 chat candidate 都必须通过同一个 `AgentWorkItemService` 落库
- Agent 只能返回 work item candidate，不能绕过 Backend 直接持久化 work item
- 转换 work item 时必须在事务内检查状态仍为 `pending/opened`
- 对 `pending/opened` 状态建立唯一约束或等效应用层锁，避免重复刷屏

### 5.2 新增 `AgentQualityCheck`

用于保存 planner / evaluator / reviser 的质量检查结果。

建议字段：

- `id`
- `userId`
- `threadId`
- `runId`
- `reviewSnapshotId`
- `proposalGroupId`
- `scope`
  - `work_item`
  - `review`
  - `package`
  - `memory`
  - `outcome`
- `status`
  - `passed`
  - `downgraded`
  - `blocked`
- `score`
- `blockedReasons[]`
- `downgradeReasons[]`
- `passedPolicyLabels[]`
- `evidence` JSON
- `createdAt`

它的作用不是替代 `AgentPolicyService`，而是把“为什么这次建议可以展示 / 被降级 / 被阻断”沉淀下来。

质量分语义：

- `status`、`blockedReasons`、`downgradeReasons` 是强语义，决定本次输出能否展示、是否降级、是否阻断
- `score` 只作为内部诊断和排序信号，建议范围为 `0-100`
- `score < 60` 默认不应生成高影响 package，优先进入 reviser 或返回补数据 work item
- 前端默认不直接展示裸分，可展示为“依据充分度 / 执行可信度”
- 质量分不代表医学风险评分，也不代表训练效果保证

证据保存边界：

- `evidence` 优先保存事实摘要、实体 id、时间窗口和关键指标
- 不保存不必要的完整 message 原文、完整健康档案快照或敏感自由文本
- 如果为了 debug 必须保存原始片段，应标记来源字段，并限制在最小必要范围

### 5.3 新增 `AgentProductEvent`

用于记录关键产品行为，帮助后续评估 Agent 是否真的被使用。

建议字段：

- `id`
- `userId`
- `eventType`
  - `work_item_created`
  - `work_item_opened`
  - `work_item_dismissed`
  - `package_approved`
  - `package_rejected`
  - `feedback_submitted`
  - `revision_requested`
  - `quality_blocked`
- `source`
- `entityType`
- `entityId`
- `requestId`
- `sessionId`
- `payload` JSON
- `createdAt`

这张表不承载业务写入，只用于产品分析、debug 和质量回溯。

事件记录建议：

- 一次 Dashboard refresh、一次 revision、一次 package confirmation 应共享同一个 `requestId`
- `payload` 只记录行为摘要和实体引用，不作为业务状态来源
- 产品事件不能反向驱动高影响写库，只能用于分析、debug 和后续质量评估

## 6. 后端设计

### 6.1 新增教练工作台上下文接口

新增：

`GET /agent/context/workspace-summary`

返回建议包括：

- `coachSummary`
- `memorySummary`
- `recentOutcomes`
- `recentFeedback`
- `pendingPackage`
- `pendingWorkItems`
- `latestQualityChecks`
- `todayPlan`
- `logGapSummary`
- `recommendedEntryPoints`

`workspace-summary` 是产品入口聚合层，用于 Dashboard 和 Agent 主动检查；`coach-summary` 继续保留为复盘底层上下文接口。

边界要求：

- `workspace-summary` 是 read model / 聚合层，不承担业务写入
- 该接口可以返回建议入口和待办摘要，但不能在读取时隐式执行高影响变更
- 如需在 Dashboard 首屏触发主动检查，应由前端显式调用 `POST /agent/work-items/refresh`

### 6.2 新增 work item 接口

新增：

- `GET /agent/work-items`
- `POST /agent/work-items/refresh`
- `POST /agent/work-items/:id/open`
- `POST /agent/work-items/:id/dismiss`

职责建议：

- `refresh`
  - 读取 workspace summary
  - 按规则生成或更新 pending work item
  - 不重复创建同类型 pending item
  - 通过 `AgentWorkItemService` 统一落库，不能由 Agent runtime 直接写库
  - 返回本次创建、更新、跳过和过期的 work item 摘要
- `open`
  - 标记用户已查看该工作项
  - 可返回建议跳转目标，例如 chat、plan、logs、dashboard
- `dismiss`
  - 用户忽略某个主动建议
  - 写入 `AgentProductEvent`

后台轻量检查边界：

- `scheduled_check` 只能创建应用内 work item，不能站外触达用户
- 调度任务必须有 per-user cooldown，避免短时间内重复生成同类事项
- 多实例部署时需要唯一约束、任务锁或等效幂等机制
- 后台任务失败不能影响用户手动打开 Dashboard 和 chat 的主流程

### 6.3 新增质量检查接口

新增：

- `GET /agent/quality/runs/:runId`
- `GET /agent/quality/proposal-groups/:proposalGroupId`

返回：

- `score`
- `status`
- `blockedReasons`
- `downgradeReasons`
- `passedPolicyLabels`
- `evidence`

质量检查结果应可被前端以 `quality_check_card` 展示。

展示建议：

- `blocked` 展示为“当前不能生成可执行建议”
- `downgraded` 展示为“已自动降级为更保守版本”
- `passed` 可以只展示摘要，不需要暴露全部内部规则
- 对用户展示 reasons，不展示模型内部推理链或敏感原始上下文

### 6.4 新增修订接口

新增：

`POST /agent/reviews/:reviewId/revise`

使用场景：

- evaluator 判断原 package 风险过高
- 用户反馈 `too_hard` / `unsafe_or_uncomfortable`
- outcome 变为 `worsened`
- 当前计划 stale，原建议不可执行

修订结果可以是：

- 新的保守 review
- 新的低风险 advice proposal
- 新的 coaching package
- 仅返回“需要补充数据”的 work item

修订仍不能绕过 proposal / confirmation。

旧建议处理规则：

- revision 必须记录 `sourceReviewId` 或 `sourceProposalGroupId`
- 如果旧 package 仍处于 pending/opened 状态，生成新版本后旧 package 应标记为 `superseded`、`stale` 或等效不可执行状态
- 同一 source review 同一时间只能存在一个最新可执行 revision
- 前端应突出最新 revision，并将旧版本只读展示为历史记录
- revision 不能直接修改已执行成功的 package，只能生成新的待确认建议或补数据 work item

## 7. Agent 运行时设计

### 7.1 Planner

Planner 负责基于 workspace summary 生成候选结果。

候选结果包括：

- work item candidate
- review candidate
- package candidate
- memory candidate
- revision candidate

Planner 输出必须结构化，至少包含：

- facts
- inferences
- recommendations
- uncertainty
- proposedActions
- expectedUserBenefit

### 7.2 Evaluator

Evaluator 负责在候选结果展示或持久化之前进行质量检查。

检查维度：

- 数据是否足够
- 是否有 medical red flag
- 是否违反 actionType 白名单
- 是否和 active memory 冲突
- 是否和 recent negative / worsened outcome 冲突
- 是否包含不可执行的计划假设
- 是否存在 stale plan 风险
- riskLevel 是否被后端 policy 正确抬升

Evaluator 输出 `AgentQualityCheck`。

### 7.3 Reviser

Reviser 负责把未通过质量门的结果转换为更安全、更保守、更可执行的版本。

降级策略：

- 完整周计划 -> 最小建议
- 多域 package -> 单条 advice snapshot
- 强训练建议 -> 恢复建议
- 高置信记忆写入 -> 记忆候选待确认
- 确定性结论 -> 带不确定性的解释

Reviser 必须保留 `downgradeReasons`，不能静默修改。

### 7.4 Renderer

Renderer 负责输出稳定的 Phase 4 卡片。

新增卡片建议：

- `work_item_card`
- `quality_check_card`
- `revision_card`
- `coach_workspace_card`

这些卡片必须支持：

- 长文本
- 多标签
- 多 evidence
- 明确状态
- 明确下一步动作
- 刷新后恢复

## 8. 前端设计

### 8.1 Dashboard 升级为教练工作台

Dashboard 建议新增一个主区域：

- 今日训练与恢复建议
- 待处理 work items
- 待确认 coaching package
- 近期 outcome
- 长期记忆摘要
- 质量检查摘要
- 最近反馈入口

该区域应成为用户日常进入产品后的主入口，而不是仅展示静态指标。

### 8.2 Work item 交互

每个 work item 至少支持：

- 查看详情
- 进入 chat 追问
- 转换为 review/package
- 忽略
- 过期后只读展示

对于高影响项，按钮文案必须明确“生成待确认建议”，不能暗示会直接写库。

### 8.3 质量检查展示

`quality_check_card` 应展示：

- 是否通过
- 是否降级
- 阻断原因
- 降级原因
- 使用的 policy labels
- 关键 evidence

用户不需要理解所有内部细节，但应能知道“为什么这次建议更保守”。

### 8.4 Chat 的角色变化

Phase 4 中 Chat 不再是唯一主入口，而是：

- 解释 Dashboard 建议
- 追问某个 work item
- 修改或拒绝记忆候选
- 让用户用自然语言补充约束
- 在执行前澄清歧义

Chat 仍然使用已有 thread / message / card 恢复机制。

## 9. actionType 扩展建议

Phase 4 不建议新增自由写库 action。

可新增：

- `create_agent_work_item`
- `dismiss_agent_work_item`
- `create_quality_check`
- `create_product_event`
- `revise_coaching_review`

这些 action 大多是系统状态或审计记录，不应直接修改训练计划、饮食、健康档案。

实现边界：

- `create_agent_work_item` 不代表 Agent 可以直接写库；它应被实现为 Backend command，由 `AgentWorkItemService` 负责鉴权、去重和落库
- `create_quality_check` 应只记录检查结果，不改变 proposal / package 的执行状态
- `revise_coaching_review` 应生成新的候选结果，并通过 evaluator 和 confirmation 链路，不得直接覆盖原业务数据
- 所有新增 action 必须有 schema、riskLevel、policy label 和跨账号测试

高影响业务写入继续复用：

- `generate_next_week_plan`
- `generate_diet_snapshot`
- `create_advice_snapshot`
- `create_coaching_memory`
- `update_coaching_memory`
- `archive_coaching_memory`

## 10. 失败模式与边界

### 10.1 主动建议刷屏

风险：

- 用户每次进 Dashboard 都看到重复建议

处理：

- 同类型 pending work item 去重
- 设置 `expiresAt`
- dismiss 后一定时间内不重复生成同类建议
- 同一用户同一 `type` 和同一关联对象建立唯一约束或等效锁
- Dashboard refresh 和 scheduled check 使用同一个去重逻辑

### 10.2 过度自动化造成不信任

风险：

- 用户以为 Agent 自动改了计划或饮食

处理：

- work item 文案明确“待确认”
- 高影响动作仍走 proposal/package
- action result card 明确展示执行结果

### 10.3 evaluator 过度阻断

风险：

- 系统变得过于保守，无法给出有用建议

处理：

- blocked 与 downgraded 分开
- 阻断只用于红旗、安全、跨账号、写库边界
- 数据不足时优先降级，不直接失败

### 10.4 质量分被误解

风险：

- 用户把质量分当成医学或训练效果保证

处理：

- 质量分只用于建议可靠性和数据充分性
- 前端展示为“依据充分度 / 执行可信度”
- 不展示为医学风险评分
- `status` 和 reasons 决定产品行为，`score` 不单独决定高影响写入
- 裸分默认仅用于内部 debug，不作为面向用户的核心文案

### 10.5 Work item 跨账号串联

风险：

- A 用户看到 B 用户待办或 package

处理：

- 所有 work item、quality check、product event 绑定 `userId`
- 所有接口通过 Bearer token 获取当前用户
- e2e 覆盖跨账号隔离

### 10.6 敏感上下文过度持久化

风险：

- work item payload、quality evidence、product event 保存过多原始健康数据或 chat 原文

处理：

- payload 和 evidence 优先保存摘要、指标、实体 id 和时间窗口
- 不把产品事件当成业务事实来源
- 对 debug 所需原文采用最小必要原则，并标记来源
- 后续如引入数据保留策略，应优先覆盖 AgentProductEvent 和 AgentQualityCheck

### 10.7 Revision 与旧 package 冲突

风险：

- 用户同时看到旧 package 和新 revision，误执行过期建议

处理：

- revision 成功后旧 pending package 必须进入 `superseded`、`stale` 或等效不可执行状态
- 前端只突出最新可执行版本
- 后端执行 package 前仍做 stale 校验

## 11. 建议实施顺序

### Phase 4.1 Work Item 骨架

- 新增 `AgentWorkItem`
- 新增 work item CRUD / refresh / dismiss
- 新增状态流转校验和 pending/opened 去重约束
- 明确 `AgentWorkItemService` 为唯一持久化入口
- 新增 `requestId`，串联 refresh、work item 和 product event
- Dashboard 展示 pending work items
- 去重和跨账号隔离测试

### Phase 4.2 Workspace Summary

- 新增 `workspace-summary`
- 聚合 coach summary、memory、outcome、feedback、pending package、work items
- Dashboard 改为消费 workspace summary
- 保留原 coach summary 调试接口

### Phase 4.3 Planner / Evaluator / Reviser

- Agent 内部拆出 planner / evaluator / reviser
- 新增 `AgentQualityCheck`
- evaluator 记录 blocked / downgraded / passed
- reviser 支持数据不足和负反馈降级
- 明确 score 范围、阈值和前端展示语义
- revision 生成新版本时处理旧 pending package 的失效状态

### Phase 4.4 产品化卡片与交互

- 新增 `work_item_card`
- 新增 `quality_check_card`
- 新增 `revision_card`
- 新增 `coach_workspace_card`
- 扩展卡片契约测试
- 长文本和多 evidence 布局测试

### Phase 4.5 产品事件与回归

- 新增 `AgentProductEvent`
- 记录 work item 和 package 关键行为
- 添加产品行为 e2e
- 回归 Phase 1/2/3 全套测试

## 12. 测试计划

### 12.1 Work Item 测试

- Dashboard refresh 只生成一条同类型 pending work item
- dismiss 后不会立即重复生成同类 work item
- work item 过期后不能转换为 package
- A 用户不能读取或处理 B 用户 work item
- `pending -> opened -> converted` 后不能再次 dismiss 或转换
- refresh、scheduled check、chat candidate 走同一去重入口

### 12.2 Workspace Summary 测试

- 返回 pending package、work items、recent outcomes、memory summary
- 无 active plan 时仍返回安全入口
- recent outcome 为 `worsened` 时生成修订建议
- 数据不足时生成 log gap work item

### 12.3 Evaluator / Reviser 测试

- red flag 阻断写库建议
- 数据不足降级为最小建议
- memory 冲突时要求澄清或降级
- stale plan 时不继续执行旧 package
- quality check 持久化 blocked / downgraded 原因
- `score < 60` 时不生成高影响 package，除非显式有人工确认策略兜底
- revision 生成新版本后旧 pending package 不再可执行
- quality evidence 不保存完整 chat 原文或完整健康档案快照

### 12.4 前端测试

- 教练工作台刷新后可恢复 work items
- `work_item_card` 按状态禁用或启用按钮
- `quality_check_card` 展示阻断和降级原因
- `revision_card` 展示旧建议与新建议差异
- 长文本、多标签、多 evidence 不破坏布局

### 12.5 回归测试

- Phase 1 proposal 单次执行与 stale 校验
- Phase 2 package 事务回滚和跨账号隔离
- Phase 3 memory / outcome / strategy / policy
- backend build、frontend build、agent Python 编译检查

## 13. 不做事项

Phase 4 明确不做：

- 无确认自动写入训练计划、饮食快照或长期记忆
- 站外 push、短信、邮件通知
- 分布式多 Agent 运行时
- 自动医疗诊断
- 自动修改 `HealthProfile`
- 引入向量数据库作为必需依赖
- 强化学习或不可解释策略优化
- 付费体系、订阅体系或商业化权限控制

这些可以作为 Phase 5 或商业化阶段再评估。

## 14. 工程质量要求

Phase 4 每个增量都必须满足：

- 有明确数据模型和迁移
- 有明确 userId 绑定和跨账号隔离测试
- 有 work item 去重策略
- 有 quality check 持久化
- 有前端刷新恢复路径
- 有卡片契约测试
- 有真实数据库 e2e 覆盖主动闭环关键路径
- 不破坏 Phase 1/2/3 的确认执行边界

## 15. 结论

Phase 4 的本质不是“让 Agent 更会聊天”，也不是“让 Agent 自动替用户做决定”，而是让整个产品具备主动、可解释、可确认、可恢复的日常教练闭环。

Phase 4 完成后，用户应该能够：

- 打开 Dashboard 就知道今天该处理什么
- 清楚看到 Agent 为什么提出某个建议
- 对高影响改动保持最终确认权
- 通过反馈、日志和执行结果持续影响后续建议
- 在 Chat、Dashboard、Plan、Logs、Diet 之间形成一致的产品体验

最重要的原则是：

> Phase 4 的智能化必须建立在主动但克制、可解释且可确认、产品闭环而非黑盒自动化之上。

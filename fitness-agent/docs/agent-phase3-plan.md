# Agent 三期规划：长期个性化记忆、建议效果评估与策略演进架构

## 1. 文档目的

本文档定义 `fitness-agent` 在 Phase 1 “可信执行基座”和 Phase 2 “闭环教练与复盘执行架构”完成之后的三期演进方案。

Phase 3 的目标不是继续单纯增加更多写库动作，而是把 Agent 从“能安全生成并执行教练包”，升级为“能长期理解用户、评估建议效果、解释建议依据、并持续演进策略的个性化教练系统”。

一句话目标：

> Phase 1 解决安全执行，Phase 2 解决周期闭环，Phase 3 解决长期个性化、质量评估和策略演进。

## 2. 前置条件

Phase 3 默认建立在以下能力已经稳定完成的前提上：

- Backend 仍然是唯一写库入口
- 前端、Agent、Backend 统一使用 Bearer token
- 单动作 proposal 已支持确认、执行、拒绝、过期、失败等状态
- `AgentActionProposal` / `AgentActionExecution` 已具备可追踪持久化
- `CoachingReviewSnapshot` 已能保存结构化复盘结果
- `AgentProposalGroup` 已能表达 coaching package
- coaching package 已支持事务执行、幂等控制、stale 校验和跨账号隔离
- `coach-summary` 已能聚合当前计划、近期日志、饮食快照、建议快照和 pending package
- Chat 与 Dashboard 已能恢复 review / package 状态
- Phase 2.4 已有关键回归测试覆盖：整包回滚、多账号隔离、长文本展示

如果上述能力尚未稳定，不建议提前实现 Phase 3。Phase 3 会引入长期记忆、质量评估和策略版本，如果基础执行链路不稳，会导致 Agent 的行为难以审计和回滚。

## 3. 三期总体目标

Phase 3 聚焦四件事：

- 建立长期用户记忆，让 Agent 不只依赖最近几条日志
- 建立建议效果评估，让系统知道上次建议是否真的有效
- 建立 evidence-first 输出，让建议的依据、推断和不确定性可解释
- 建立策略模板和版本，让教练策略可测试、可演进、可回溯

Phase 3 仍然维持以下架构边界：

- Agent 继续采用单运行时 orchestrator
- Backend 继续是唯一写库入口
- 所有高影响写动作继续先 proposal、后确认
- 不引入多 Agent 分布式运行时
- 不引入后台自动执行
- 不引入站外通知、push、短信或邮件
- 不允许 Agent 自由修改 `User` / `HealthProfile`
- 不做医疗诊断，不把推断包装成医学事实

## 4. 核心能力升级

### 4.1 长期用户记忆

Phase 2 的 Agent 主要依赖当前计划、最近日志和最近快照。Phase 3 需要新增一个可审计的长期记忆层，用于记录稳定偏好和长期约束。

记忆内容包括：

- 喜欢或排斥的训练方式
- 常用训练时间
- 可用设备和环境限制
- 常见失败原因
- 恢复敏感点
- 饮食偏好和禁忌
- 用户历史上拒绝或采纳过的建议类型
- Agent 从 outcome 中总结出的长期模式

记忆层不是自由文本黑盒。每条记忆都必须保存来源、置信度、更新时间和可撤销状态。

### 4.2 建议效果评估闭环

Phase 2 能生成 review 和 package，但还缺少“建议后来有没有用”的评价机制。

Phase 3 需要在 package 执行之后持续评估：

- 计划完成率是否提升
- 睡眠和疲劳是否改善
- 训练时长和频率是否稳定
- 用户是否拒绝、忽略或反复修改建议
- 建议是否太难、太轻、太泛或不适合

第一版评估建议使用规则和阈值，不急于引入复杂模型。

### 4.3 Evidence-first 输出

Agent 输出 review / package / daily guidance 时，应明确区分：

- 事实数据：来自计划、日志、指标、快照
- 推断结论：Agent 根据数据做出的解释
- 建议动作：需要用户确认后执行
- 不确定性：数据不足、数据冲突或无法判断

这样可以避免用户把 Agent 的推断误认为系统事实，也方便后续 debug 和产品展示。

### 4.4 策略模板化

当前 Agent 的部分教练逻辑仍偏硬编码。Phase 3 应把 coaching strategy 抽成可版本化模板。

策略模板可以覆盖：

- 数据不足最小建议
- 恢复优先周
- 低能量周
- 稳定减脂周
- 渐进增肌周
- 旅行或设备不足周
- 计划执行落后时的降级周

每次 review / package 都应记录使用了哪个策略模板和版本，便于回溯、调参和 A/B 式验证。

### 4.5 更强的安全分级

Phase 1/2 使用 `low` / `medium` / `high` 风险等级。Phase 3 建议在内部引入更细的 policy label。

建议分级：

- `read_only`
- `low_risk_write`
- `memory_update`
- `plan_rewrite`
- `nutrition_rewrite`
- `multi_domain_package`
- `medical_red_flag`

不同 policy 对应不同约束：

- 是否允许自动生成
- 是否必须用户确认
- 是否允许进入 package
- 是否必须二次确认
- 是否只允许返回非医疗建议
- 是否禁止写库

## 5. 数据模型建议

### 5.1 新增 `UserCoachingMemory`

用于保存当前有效的长期记忆。

建议字段：

- `id`
- `userId`
- `memoryType`
  - `training_preference`
  - `equipment_constraint`
  - `schedule_preference`
  - `recovery_pattern`
  - `diet_preference`
  - `behavior_pattern`
  - `safety_constraint`
- `title`
- `summary`
- `value` JSON
- `confidence`
- `sourceType`
  - `chat`
  - `workout_log`
  - `daily_checkin`
  - `body_metric`
  - `review`
  - `manual_feedback`
  - `outcome`
- `sourceId`
- `status`
  - `active`
  - `archived`
  - `rejected`
  - `superseded`
- `createdAt`
- `updatedAt`

### 5.2 新增 `CoachingMemoryEvent`

用于记录记忆如何产生、更新、归档或被用户纠正。

建议字段：

- `id`
- `userId`
- `memoryId`
- `eventType`
  - `created`
  - `updated`
  - `archived`
  - `corrected`
  - `rejected`
- `reason`
- `before` JSON
- `after` JSON
- `sourceType`
- `sourceId`
- `createdAt`

### 5.3 新增 `CoachingOutcome`

用于评估一次 package 或 review 后续效果。

建议字段：

- `id`
- `userId`
- `reviewSnapshotId`
- `proposalGroupId`
- `strategyTemplateId`
- `strategyVersion`
- `status`
  - `pending`
  - `measuring`
  - `improved`
  - `neutral`
  - `worsened`
  - `inconclusive`
- `measurementStart`
- `measurementEnd`
- `baseline` JSON
- `observed` JSON
- `score`
- `signals` JSON
- `summary`
- `createdAt`
- `updatedAt`

### 5.4 新增 `RecommendationFeedback`

用于保存用户对建议的显式反馈。

建议字段：

- `id`
- `userId`
- `reviewSnapshotId`
- `proposalGroupId`
- `feedbackType`
  - `helpful`
  - `too_hard`
  - `too_easy`
  - `not_relevant`
  - `unsafe_or_uncomfortable`
  - `unclear`
- `note`
- `createdAt`

### 5.5 新增 `CoachingStrategyTemplate`

用于保存可版本化的策略模板。

建议字段：

- `id`
- `key`
- `version`
- `title`
- `description`
- `triggerRules` JSON
- `riskPolicy`
- `outputShape` JSON
- `status`
  - `draft`
  - `active`
  - `archived`
- `createdAt`
- `updatedAt`

### 5.6 扩展现有模型

建议扩展 `CoachingReviewSnapshot`：

- `strategyTemplateId`
- `strategyVersion`
- `evidence` JSON
- `uncertaintyFlags[]`

建议扩展 `AgentProposalGroup`：

- `strategyTemplateId`
- `strategyVersion`
- `policyLabels[]`
- `outcomeId`

## 6. 后端设计

### 6.1 新增记忆读取接口

新增：

`GET /agent/context/memory-summary`

返回：

- active memories
- recent memory events
- memory confidence summary
- user-corrected memories
- safety constraints

`coach-summary` 应合并 memory 摘要，但仍保留独立接口，便于调试和单独测试。

### 6.2 新增记忆命令接口

建议新增：

- `POST /agent/commands/create-memory`
- `POST /agent/commands/update-memory`
- `POST /agent/commands/archive-memory`

这些命令必须继续走 proposal / confirmation。

低风险记忆也不建议完全自动写入，因为错误记忆会长期影响后续建议。

### 6.3 新增 outcome 评估服务

建议新增 `CoachingOutcomeService`，职责包括：

- package 执行成功后创建 pending outcome
- 读取后续日志并计算 outcome
- 生成 outcome summary
- 给下一次 `coach-summary` 提供近期效果数据

第一版评估规则可以简单稳定：

- 计划完成率提升：`improved`
- 疲劳升高且完成率下降：`worsened`
- 数据不足：`inconclusive`
- 指标变化不明显：`neutral`

### 6.4 新增策略选择服务

建议新增 `CoachingStrategyService`，职责包括：

- 读取 active strategy templates
- 根据 coach summary / memory / outcome 选择策略
- 返回结构化 strategy decision
- 记录本次使用的 template 和 version

Agent 仍负责 orchestrate，但不要把策略规则全部硬编码在 Python runtime 中。

### 6.5 安全策略服务

建议新增 `AgentPolicyService` 或在 `AgentStateService` 中拆出 policy 层。

职责：

- 判断 actionType 是否允许
- 判断 actionType 是否允许进入 package
- 判断 policy label 是否需要二次确认
- 判断 red flag 是否禁止写库
- 统一生成前端可展示的风险说明

## 7. Agent 运行时设计

Phase 3 仍保持单运行时，但内部逻辑建议进一步分层：

- `context_reader`
  - 读取 coach summary、memory summary、recent outcome
- `evidence_builder`
  - 将事实、推断、不确定性拆开
- `strategy_selector`
  - 选择策略模板
- `proposal_builder`
  - 生成 proposal / package
- `memory_candidate_builder`
  - 生成候选记忆，但不直接写入
- `outcome_interpreter`
  - 将历史 outcome 变成下一次建议的约束

### 7.1 新增 Agent API

建议新增：

- `GET /agent/threads/:threadId/memory-state`
- `POST /agent/memory/candidates`
- `POST /agent/memory/:memoryId/archive`
- `POST /agent/feedback/recommendation`
- `GET /agent/threads/:threadId/outcomes`

### 7.2 记忆更新流程

典型流程：

1. 用户在 chat 中说出稳定偏好，例如“不喜欢跑步，膝盖不舒服”
2. Agent 识别为 memory candidate
3. Agent 生成 `memory_update` proposal
4. 用户确认
5. Backend 写入 `UserCoachingMemory` 和 `CoachingMemoryEvent`
6. 后续 review/package 自动读取 memory

### 7.3 Outcome 评估流程

典型流程：

1. 用户确认 coaching package
2. Backend 执行 package
3. Backend 创建 `CoachingOutcome(status=pending)`
4. 用户后续录入 workout log / daily checkin / body metric
5. Outcome service 更新 outcome
6. 下一次 review 引入 outcome 作为 evidence

### 7.4 策略选择流程

典型流程：

1. Agent 调 `coach-summary`
2. Agent 调 `memory-summary`
3. Agent 调 `recent-outcomes`
4. Backend 或 Agent 选择 strategy template
5. Agent 生成 evidence-first review
6. Agent 生成 package
7. Backend 持久化 template id/version

## 8. 前端设计

### 8.1 Dashboard 新增教练记忆区域

Dashboard 建议新增：

- 当前教练记忆
- 高置信记忆
- 待确认记忆
- 最近被用户纠正的记忆

用户应能：

- 查看某条记忆来源
- 归档错误记忆
- 明确拒绝某条候选记忆

### 8.2 Chat 新增 evidence 展示

建议新增或扩展卡片：

- `evidence_card`
- `memory_candidate_card`
- `outcome_summary_card`
- `strategy_decision_card`

每张卡片必须支持长文本、多标签、多数据来源，不破坏布局。

### 8.3 Package 预览升级

Package card 应展示：

- 使用的策略模板
- 关键事实依据
- 主要推断
- 不确定性
- 将要写入的对象
- policy labels
- 是否会创建 outcome

### 8.4 Profile 记忆管理

Profile 页面可以新增“教练偏好”区域，展示用户长期偏好。

这部分不建议和 `HealthProfile` 混在一起，因为 `HealthProfile` 更像用户明确填写的基础资料，而 coaching memory 是 Agent 从交互中总结出的可撤销知识。

## 9. actionType 扩展建议

Phase 3 新增建议：

- `create_coaching_memory`
- `update_coaching_memory`
- `archive_coaching_memory`
- `create_recommendation_feedback`
- `refresh_coaching_outcome`

不建议新增自由写库 action。每个 action 都必须有明确 payload schema、风险等级和测试覆盖。

## 10. 失败模式与边界

### 10.1 错误记忆长期污染建议

处理策略：

- 记忆必须可查看、可归档、可纠正
- 每条记忆保存 source 和 confidence
- 低置信记忆不能直接影响高风险 package

### 10.2 Outcome 数据不足

处理策略：

- 标记为 `inconclusive`
- 不强行判断建议有效或无效
- 下一次 review 明确说明数据不足

### 10.3 策略模板误选

处理策略：

- 保存 strategy decision evidence
- 在测试中固定输入输出
- 用户反馈可反向影响后续选择

### 10.4 Red flag 风险

处理策略：

- 出现胸痛、晕厥、药物、极端减重等信号时，禁止写库
- 只返回非医疗、保守建议
- 提醒用户寻求专业帮助

### 10.5 多账号隔离

所有新增模型必须绑定 `userId`。

必须测试：

- A 用户不能读取 B 用户 memory
- A 用户不能确认 B 用户 memory proposal
- A 用户 outcome 不进入 B 用户 coach summary

## 11. 建议实施顺序

### Phase 3.1 记忆层骨架

- 新增 `UserCoachingMemory`
- 新增 `CoachingMemoryEvent`
- 新增 `memory-summary`
- 新增 memory proposal action
- 前端展示教练记忆
- 多账号隔离测试

### Phase 3.2 Outcome 评估闭环

- 新增 `CoachingOutcome`
- package 执行成功后创建 outcome
- 后续日志触发 outcome 更新
- `coach-summary` 返回 recent outcomes
- Dashboard 展示上次建议效果
- 真实数据库 e2e 测试 outcome 创建与隔离

### Phase 3.3 策略模板化

- 新增 `CoachingStrategyTemplate`
- seed 初始策略模板
- 新增 strategy selector
- review/package 保存 template id/version
- 单元测试覆盖模板选择

### Phase 3.4 Evidence-first 输出

- 扩展 review/package payload
- 前端新增 evidence 展示
- Agent 输出事实、推断、不确定性
- 长文本、多标签、多 evidence 测试

### Phase 3.5 Policy 与安全回归

- 新增 policy label
- 收敛 actionType 白名单
- red flag 禁止写库
- stale memory / stale outcome / stale package 测试
- golden fixture 测试 Agent 结构化输出稳定性

## 12. 测试计划

### 12.1 记忆测试

- 用户确认记忆 proposal 后，memory 和 event 同时落库
- 用户拒绝记忆 proposal 后，不写入 memory
- 用户归档 memory 后，`memory-summary` 不再返回 active memory
- A 用户不能读取或修改 B 用户 memory

### 12.2 Outcome 测试

- package 执行成功后自动创建 pending outcome
- 后续 workout log / daily checkin 可更新 outcome
- 数据不足时 outcome 为 `inconclusive`
- outcome 不跨账号出现在 coach summary 中

### 12.3 策略测试

- 数据不足时选择 minimal strategy
- 疲劳高时选择 recovery strategy
- 完成率稳定且恢复良好时选择 progression strategy
- 用户长期偏好会影响策略选择

### 12.4 Evidence 测试

- review 中包含 fact / inference / recommendation / uncertainty
- 数据不足时 uncertainty 明确出现
- 长 evidence 不破坏 Chat 和 Dashboard 布局

### 12.5 安全测试

- red flag 输入不会生成写库 proposal
- 高风险 policy 必须确认
- 不支持的 actionType 不能进入 package
- stale memory proposal 被拒绝执行

## 13. 不做事项

Phase 3 明确不做：

- 后台自动执行 review 或 package
- 无确认自动写入训练计划、饮食快照或长期记忆
- 站外通知
- 多 Agent 分布式协作
- 自动医疗判断
- 自动修改 `HealthProfile`
- 引入复杂向量数据库
- 引入强化学习或不可解释策略优化

这些能力可以作为更后续阶段评估，但不应进入 Phase 3 的主线。

## 14. 工程质量要求

Phase 3 每个增量都必须满足：

- 有明确数据模型和迁移
- 有明确 actionType 白名单
- 有跨账号隔离测试
- 有失败状态和回滚语义
- 有前端刷新恢复路径
- 有长文本和多标签展示测试
- 有真实数据库 e2e 覆盖关键写链路
- Agent 输出结构稳定，不能只依赖自由文本

## 15. 结论

Phase 3 的本质不是“让 Agent 更会聊天”，而是让系统具备长期教练能力：

- 能记住用户
- 能评估建议效果
- 能解释为什么这样建议
- 能用版本化策略持续演进
- 能在每一次写入前保持可确认、可回滚、可审计

最重要的原则是：

> Phase 3 的智能化必须建立在可审计数据、明确策略和稳定测试之上，而不是建立在不可追踪的自由文本记忆或不可回滚的自动写入上。

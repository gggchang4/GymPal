# Agent 二期规划：闭环教练与复盘执行架构

## 1. 文档目的

本文档定义 `fitness-agent` 在 **一期“可确认写库 Agent”完成之后** 的二期演进方案。  
二期的目标不是单纯增加更多写接口，而是把 Agent 从“能理解并执行单个动作的助手”，升级成“能够基于周期数据完成复盘、生成成套建议、并推动下一周期执行的闭环教练系统”。

这份文档是 **纯规划文档**，用于后续实施，不代表当前仓库已经开始落二期代码。

## 2. 前置条件

二期默认建立在以下一期能力已经稳定完成的前提上：

- Agent 已具备结构化 proposal 能力
- proposal 已支持“用户确认后再执行”
- Backend 已成为唯一写库入口
- Agent 的线程、run、proposal、execution 已具备可追踪持久化能力
- 前端已支持 action proposal card / action result card
- 当前训练计划、Todo、日志录入等一期闭环已经稳定

如果上述能力没有完成，二期不建议提前落库实现，否则会导致：

- review / package 没有稳定的基础 proposal 能力承载
- package 确认与执行边界不清晰
- 前后端接口重复返工
- 二期复杂度提前压到一期尚未稳定的运行时上

一句话原则：

> 一期先解决“能安全执行”，二期再解决“能持续复盘并形成闭环”。

## 3. 二期总体目标

二期聚焦把 Agent 升级为“闭环教练”：

- 读取近期身体指标、打卡、训练完成度、当前计划、饮食快照、建议快照
- 自动形成周期性复盘结论，而不是只回答单轮问题
- 将“下周训练调整 + 饮食建议 + 行为提醒”打包为一个可确认的 coaching package
- 用户一次确认后，由 Backend 事务性落库并刷新 `dashboard / plan / todo / logs / diet`
- 在 chat 与 dashboard 中都能恢复并展示未处理 package、已生成 review、已应用结果

二期仍维持以下架构边界：

- Agent 继续采用单运行时 orchestrator
- Backend 继续是唯一写库入口
- 所有写动作默认仍然先提案、后确认
- 不引入多智能体分布式运行时
- 不引入后台自动执行、站外通知、push、短信、邮件

## 4. 核心能力升级

### 4.1 从“单动作提案”升级为“教练包提案”

一期 proposal 的中心单位是“单动作”。  
二期要新增一个更高层的组合单位：

- `proposal group`
- 或业务上更易理解的 `coaching package`

一张 package 卡可以包含多条原子 proposal，例如：

- 生成下周训练计划
- 生成新的饮食快照
- 生成本周行为建议

这意味着二期不是推翻一期 proposal 机制，而是在其上层增加一个组合层。

### 4.2 新增两条主流程

#### `weekly_review_flow`

适用于：

- 周复盘
- 下周训练重排
- 饮食建议刷新
- 周期性建议更新

典型触发方式：

- 用户主动点击“开始本周复盘”
- 用户进入 dashboard 时触发检查
- 用户在 chat 中明确提出“复盘本周”或“生成下周安排”

#### `daily_guidance_flow`

适用于：

- 日常恢复建议
- 当天训练是否减量
- 基于睡眠/疲劳/打卡的轻量指导

典型触发方式：

- 用户主动点击“生成今日建议”
- 用户进入页面时检查是否需要轻量提醒
- 用户在 chat 中询问“今天该不该练”“今晚怎么调”

### 4.3 Agent 内部逻辑分层

二期仍然保持单运行时，不拆成多个独立 Agent 进程，但内部逻辑建议分层：

- `reviewer`
  - 汇总近期数据并形成结构化复盘输入
- `planner`
  - 基于复盘结果产出下周计划 / 饮食建议 / 行为建议
- `package_builder`
  - 将多个原子建议打包成一个可确认的 coaching package

这只是逻辑职责分层，不引入多进程或外部重型编排框架。

## 5. 数据模型建议

### 5.1 新增 `CoachingReviewSnapshot`

用于保存一次结构化复盘结果，建议包含：

- `id`
- `userId`
- `threadId`
- `runId`
- `reviewType`
  - `weekly_review`
  - `daily_guidance`
- `status`
  - `pending`
  - `rejected`
  - `applied`
  - `expired`
- `periodStart`
- `periodEnd`
- `title`
- `summary`
- `inputSummary` JSON
- `resultPreview` JSON
- `adherenceScore`
- `riskFlags[]`
- `suggestionTags[]`
- `createdAt`
- `updatedAt`

它的作用不是代替聊天消息，而是把“这次复盘到底基于什么数据、得出了什么结论”单独沉淀下来。

### 5.2 新增 `AgentProposalGroup`

用于表达“一次确认包含多条 proposal”的组合关系，建议包含：

- `id`
- `userId`
- `threadId`
- `runId`
- `reviewSnapshotId`
- `status`
  - `pending`
  - `rejected`
  - `applied`
  - `expired`
  - `superseded`
- `title`
- `summary`
- `preview` JSON
- `riskLevel`
- `requiresConfirmation`
- `expiresAt`
- `appliedAt`
- `createdAt`
- `updatedAt`

### 5.3 继续复用一期 proposal / execution

二期应继续复用并扩展一期的：

- `AgentActionProposal`
- `AgentActionExecution`

也就是说，二期的 package 是 proposal 的组合，不是另一套完全独立的执行系统。

### 5.4 继续复用现有业务模型

二期不建议新增独立 Todo 体系，而是继续复用：

- `WorkoutPlan / WorkoutPlanDay`
- `DietRecommendationSnapshot`
- `AdviceSnapshot`

这样可以保持：

- 计划与 Todo 仍然同源
- dashboard / plan / diet 页面仍然消费原有业务模型
- 二期新增的只是“如何产出和确认这些结果”，不是新增一套平行业务数据

## 6. 后端设计

### 6.1 新增 Agent 聚合上下文接口

新增面向 Agent 的聚合读取接口，例如：

`GET /agent/context/coach-summary`

一次性返回：

- 用户基础资料摘要
- 当前 active plan
- 当前计划完成度
- 最近 body metrics
- 最近 daily check-ins
- 最近 workout logs
- 最近 diet snapshot
- 最近 advice snapshots
- 当前是否存在 pending package
- 当前是否建议触发 weekly review / daily guidance

这个接口的目标是让 Agent 在一次读取里拿到足够上下文，而不是到处拼多个零散接口。

### 6.2 新增教练包执行接口

新增命令接口，至少包括：

- `POST /agent/commands/apply-coaching-package`
- `POST /agent/commands/generate-diet-snapshot`
- `POST /agent/commands/apply-next-week-plan`

建议职责：

- `apply-coaching-package`
  - 事务性执行整包动作
- `generate-diet-snapshot`
  - 根据已确认 payload 生成并写入饮食快照
- `apply-next-week-plan`
  - 归档旧 active plan，写入新计划

### 6.3 教练包执行必须事务化

这是二期最关键的后端原则之一。

例如一个 package 内包含：

- 新周计划
- 新饮食快照
- 新建议快照

则 Backend 必须保证：

- 要么全部成功
- 要么全部回滚

不允许出现：

- 计划改了但饮食没改
- advice 写入成功但 package 状态没更新
- review 显示已应用但真实数据没落全

### 6.4 stale 与幂等控制

二期继续沿用一期安全策略，但要扩展到 package 级别：

- package 必须有 `expiresAt`
- 执行前重新校验当前 active plan 是否仍是生成 package 时的基线
- 同一 `idempotencyKey` 不得重复执行
- 当前存在未处理 package 时，不要重复生成冲突 package

## 7. Agent 运行时设计

### 7.1 二期新增 Agent API

对前端暴露的 Agent API 建议包括：

- `GET /agent/threads/:threadId/review-state`
- `POST /agent/reviews/weekly`
- `POST /agent/reviews/daily-guidance`
- `POST /agent/proposal-groups/:groupId/approve`
- `POST /agent/proposal-groups/:groupId/reject`

### 7.2 周复盘流程

建议流程：

1. 前端触发 `POST /agent/reviews/weekly`
2. Agent 调 `coach-summary`
3. Agent 聚合本周执行、恢复、饮食、体重趋势
4. Agent 生成结构化 review
5. Agent 生成 package
6. Agent 持久化 `CoachingReviewSnapshot + ProposalGroup + proposals`
7. 前端展示：
   - `weekly_review_card`
   - `coaching_package_card`

### 7.3 日建议流程

建议流程：

1. 前端触发 `POST /agent/reviews/daily-guidance`
2. Agent 调 `coach-summary`
3. Agent 识别：
   - 是否睡眠偏低
   - 是否疲劳偏高
   - 是否计划执行落后
4. Agent 生成轻量建议
5. 若涉及写动作，则生成 package
6. 前端展示：
   - `daily_guidance_card`
   - 如有必要，再附带 `coaching_package_card`

### 7.4 Chat 与 Dashboard 双入口

二期应支持两条前端入口：

#### Chat

适合自然语言触发：

- “帮我复盘这周”
- “生成下周训练和饮食建议”
- “今天状态一般，帮我看今晚怎么练”

#### Dashboard

适合产品化入口：

- “开始本周复盘”
- “生成今日建议”
- “待确认的下周建议”
- “上一次教练包执行结果”

### 7.5 二期仍不做的事情

二期明确不实现：

- 自动后台定时执行 review
- 无确认自动写库
- 站外通知
- 多 Agent 分布式协作
- 自由修改 `User` / `HealthProfile`
- exercise catalog 自动增删改

## 8. 前端设计

### 8.1 Chat 页面新增卡片类型

新增：

- `weekly_review_card`
- `daily_guidance_card`
- `coaching_package_card`

卡片应该至少展示：

- 标题
- 摘要
- 风险等级
- 本次结论标签
- 当前状态
- package 中包含哪些动作
- 确认 / 拒绝按钮

### 8.2 Dashboard 新增复盘区域

dashboard 二期建议增加一个独立板块：

- “开始本周复盘”
- “生成今日建议”
- “待确认的教练包”
- “最近一次复盘”
- “最近一次已应用结果”

### 8.3 教练包卡片的预览形式

教练包卡片不应只显示一段纯文本，建议展示结构化对比：

- 当前计划 vs 建议计划
- 当前饮食快照 vs 新饮食建议
- 本周问题信号
- 下周优先事项

这会比纯 bullet list 更适合作为确认入口。

### 8.4 页面恢复能力

刷新页面后，用户应能恢复看到：

- 最近 review
- 当前 pending package
- 最近已应用 package

因此，前端不能把这些状态只放在内存里，必须依赖后端持久化结果恢复。

## 9. actionType 扩展建议

在一期已有 actionType 基础上，二期新增建议包括：

- `generate_next_week_plan`
- `generate_diet_snapshot`
- `create_advice_snapshot`
- `apply_coaching_package`

这里的 `apply_coaching_package` 更适合作为组合级动作标识，而不是直接替代里面的原子 proposal。

## 10. 失败模式与边界

二期实现时要明确以下异常场景：

### 10.1 用户数据不足

如果近期数据不足：

- 不生成伪完整的下周计划
- 可以生成“缺失信息提示 + 最小建议”
- 前端明确提示还缺哪些数据

### 10.2 当前已有 pending package

如果当前已有未处理 package：

- 不重复生成第二个冲突 package
- 前端优先提示用户先处理现有 package

### 10.3 active plan 已变化

如果 package 基于旧 plan 生成，但确认时 active plan 已变化：

- 返回 stale 错误
- 要求用户刷新并重新生成 review

### 10.4 一组动作部分失败

如果 package 内某个动作执行失败：

- 整包回滚
- package 状态不要标记为 applied
- execution 记录中保留失败原因

### 10.5 多账号切换

review 与 package 必须绑定 `userId`：

- 不允许串到其他用户
- 不允许跨账号确认

## 11. 建议实施顺序

等一期完成后，二期建议按以下顺序落地：

### Phase 2.1 数据与后端骨架

- 新增 `CoachingReviewSnapshot`
- 新增 `AgentProposalGroup`
- 对接一期 proposal / execution 模型
- 新增 `coach-summary`
- 新增 package 命令接口

### Phase 2.2 Agent review/package 流

- 实现 `weekly_review_flow`
- 实现 `daily_guidance_flow`
- 实现 package 组合逻辑
- 实现 review-state 查询

### Phase 2.3 前端可视化

- Chat 支持 review / package 卡片
- Dashboard 新增复盘入口和待处理建议区
- 实现 approve / reject 交互

### Phase 2.4 稳定性与回归

- stale package 测试
- 幂等测试
- 整包回滚测试
- 多账号隔离测试
- 长文本/长 exercises/多标签展示测试

## 12. 测试计划

### 12.1 周复盘主流程

- 用户有完整一周数据时，能生成 review + package
- 用户确认后，计划、饮食快照、建议快照全部成功写入
- 当前存在 pending package 时，不再生成新的冲突 package

### 12.2 日建议流程

- 睡眠偏低时，能生成恢复型建议
- 疲劳偏高时，能建议减量或恢复
- 数据不足时，返回最小建议而不是伪完整方案

### 12.3 教练包执行

- 一次确认后，整包事务性成功
- 任一子动作失败时，整包回滚
- 同一 `idempotencyKey` 重复提交时，不重复执行

### 12.4 前端交互

- chat 中能看到 review/package 卡片
- dashboard 中能看到待处理建议
- 用户拒绝 package 后状态更新正确
- 刷新页面后 review / package / 已应用结果可恢复

### 12.5 边界与异常

- active plan 已变化导致 stale
- 没有 active plan 时仍返回安全建议
- 多账号切换不串状态
- 长文本建议不破坏布局

## 13. 结论

二期的本质不是“再让 Agent 多写几张表”，而是要把系统升级成：

- 能基于历史执行做复盘
- 能生成成套建议
- 能通过一次确认应用成套结果
- 能在 chat 和 dashboard 中形成统一的闭环体验

最重要的一点是：

> 二期必须建立在一期 proposal / approval / execution 能力已经稳定的前提上，否则二期会把复杂度过早叠加到尚未完成的基础设施上。

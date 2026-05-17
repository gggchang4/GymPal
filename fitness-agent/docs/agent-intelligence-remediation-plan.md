# Agent 智能化整改规划

## 1. 背景

当前 Fitness Agent 已经有不错的工程底座：后端统一持久化、提案确认、动作执行策略、审计记录、Coaching 状态模型、Memory/Outcome/Quality/WorkItem 等数据结构。

但从用户体验看，它仍然不像一个真正智能的 Agent：

- 回答经常过短，缺少展开和解释。
- 对用户真实意图的理解不稳定。
- 多轮对话里的指代、上下文、省略表达处理较弱。
- 训练计划、饮食建议、复盘、调整等功能还达不到产品级教练体验。
- 很多“Agent 能力”本质上还是规则流、模板流和状态机，而不是推理、规划、工具调用闭环。

本规划的目标是把这些问题转化为可执行的工程整改路线。核心原则不是牺牲安全性，而是把“智能”放到正确的位置：LLM 负责理解、规划、生成和解释；后端继续负责数据、策略、执行和审计。

## 2. 产品目标

后续版本的 Agent 应该具备这些能力：

1. 能理解自然、模糊、多轮、带省略的中文用户请求。
2. 在信息不足时主动追问，而不是生硬猜测或给模板答案。
3. 回答时默认使用用户画像、目标、偏好、约束、历史训练、近期疲劳、执行结果。
4. 能生成高质量训练计划、饮食建议、每日指导、周复盘和调整方案。
5. 能解释自己的判断依据，但不过度打扰用户。
6. 所有会改变用户数据的动作仍然走“提案 -> 确认 -> 执行 -> 审计”流程。
7. 当 LLM 或外部工具不可用时，产品明确进入降级模式，而不是假装智能。

## 3. 工程原则

### 3.1 LLM 做推理，后端做执行

系统应保持如下职责边界：

```text
用户请求
-> Agent 理解意图
-> Agent 读取上下文和工具
-> Agent 生成回答或动作提案
-> 后端策略校验
-> 用户确认
-> 后端执行命令
-> 审计记录
```

Agent 不直接写数据库。所有状态改变都必须通过后端命令、策略和确认机制完成。

### 3.2 用结构化协议替代散乱文本

Agent 的关键判断必须是结构化输出，而不是自由文本：

- intent：用户意图
- confidence：置信度
- missing_fields：缺失信息
- risk_flags：风险标记
- tool_plan：工具计划
- proposed_actions：拟执行动作
- final_response：最终回复

每个结构化输出都要有 schema 校验、失败处理和测试覆盖。

### 3.3 信息不足时先澄清

涉及以下情况时，Agent 应优先追问：

- 疼痛、伤病、医学风险
- 训练强度和训练容量
- 饮食禁忌和过敏
- 日程变更
- 写入用户数据
- 生成或调整计划
- 用户表达明显含糊，例如“按刚才那个改一下”

### 3.4 用评测驱动智能迭代

不能只测试 API 合同和数据库状态，还要测试 Agent 是否真的理解用户。后续必须加入：

- 意图识别评测
- 多轮对话评测
- 工具选择评测
- 计划质量评测
- 安全与降级评测
- 前端交互 E2E 测试

### 3.5 降级模式必须可见

当 LLM 调用失败、超时、鉴权失败或模型质量不达标时，系统必须记录原因，并在前端表现为“受限模式”。不能静默返回模板答案，让用户误以为这是智能 Agent 的真实能力。

## 4. 当前根因总结

### 4.1 LLM 不在“大脑”位置

当前 `agent/app/agents.py` 的核心流程主要靠关键词分流。LLM 只在部分路径里负责把已有 fallback 内容润色成回复。周复盘、每日指导、记忆写入、计划生成、工作项等大量能力仍是确定性规则。

结果：

- Agent 不能稳定理解不同说法下的同一意图。
- Agent 不会真正规划下一步动作。
- Agent 很难像产品级助手一样主动追问、读取上下文、调用工具、再综合回答。

### 4.2 Prompt 和运行时都在压缩回答

LLM 渲染提示中明确要求 `Keep the reply concise`，并且最终输出字段固定。运行时代码还会限制 `next_actions` 和卡片 bullet 数量。

结果：

- 回答天然偏短。
- 很难展开解释、比较方案、给出推理依据。
- 用户会觉得 Agent “不聪明”或“敷衍”。

### 4.3 多轮上下文没有成为推理输入

前端当前主要发送本轮文本。虽然后端保存了 thread/message，但 Agent 在意图判断和生成回复时，没有构造完整的对话上下文窗口。

结果：

- “那明天呢”“按刚才那个计划改”“我还是想轻一点”这类表达很容易失效。
- Agent 更像无状态问答接口，而不是持续协作的助手。

### 4.4 高级功能多数还是规则骨架

后端 schema 中已经有 memory、outcome、strategy、quality、work item、product event 等结构，但服务层多为固定规则和模板。

结果：

- 架构看起来已经进入 Phase 4，但智能层没有跟上。
- 复盘、建议、工作项更像自动化提醒，而不是个性化教练判断。

### 4.5 计划和饮食生成仍然硬编码

当前训练计划生成、计划调整、饮食建议中有大量固定模板。用户目标、伤病、器械、时间、训练水平、近期疲劳、执行率、偏好等没有充分进入生成逻辑。

结果：

- 计划不够个性化。
- 调整不像真正的教练决策。
- 很难达到可售卖产品的体验。

### 4.6 LLM 可用性没有被产品化处理

当前环境使用 `openrouter/free`，历史运行日志中出现过 OpenRouter 401 鉴权失败。LLM 失败后系统会 fallback 到短模板。

结果：

- 用户看到的“不智能”可能是模型根本没有成功工作。
- 前端和日志没有足够清晰地告诉用户或开发者当前处于降级状态。

### 4.7 前端没有把 Agent 工作过程表现出来

聊天页没有充分使用流式输出、工具事件、下一步动作、澄清状态、提案 diff、执行结果等交互能力。

结果：

- 即使后端有提案和 workspace，用户仍然只看到一个普通聊天框。
- Agent 缺少“我正在读取你的计划、检查最近训练、准备调整方案”的过程感。

## 5. 目标架构

```text
Frontend
  - Chat
  - Streaming
  - Tool Timeline
  - Clarification UI
  - Proposal Review
  - Coach Workspace

Agent API
  - Conversation Context Builder
  - Intent Classifier
  - Planner
  - Tool Loop
  - Response Composer
  - Quality Critic
  - Fallback Manager

Tool Gateway
  - Typed Read Tools
  - Typed Proposal Tools
  - Typed Confirmation Tools
  - External APIs

Backend
  - Source of Truth
  - Policy Check
  - Proposal State
  - Command Execution
  - Audit Trail
  - Metrics and Evals
```

理想的 Agent 运行链路：

```text
用户消息
-> 加载对话历史和用户上下文
-> 结构化意图识别
-> 判断是否需要澄清
-> 规划需要读取哪些工具
-> 执行只读工具
-> 生成回答或动作提案
-> 质量和安全检查
-> 持久化运行轨迹
-> 返回前端
```

## 6. 分阶段改造路线

### Phase 0：模型可靠性与可观测性

目标：先确保系统知道 LLM 是否真的在工作。

修改项：

- 将 `openrouter/free` 替换为明确的生产级模型配置。
- 启动时校验 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL_ID`、timeout、max tokens。
- 增加 `/agent/health/llm` 健康检查接口，执行一次小型结构化生成。
- 持久化每次 LLM 调用的 model、latency、status、token usage、fallback reason。
- LLM 失败时向前端返回 degraded mode 标记。
- 前端展示轻量降级状态，避免静默返回模板答案。

验收标准：

- LLM key 错误时，启动日志和健康检查能明确暴露。
- 每条 Agent 回复都能追踪到模型调用、fallback 原因、工具调用和策略结果。
- 前端能区分“模型回答”和“受限模式回答”。

主要文件：

- `agent/app/config.py`
- `agent/app/llm.py`
- `agent/app/main.py`
- `agent/app/trace_logger.py`
- `backend/src/controllers/agent-state.controller.ts`
- `frontend/app/chat/page.tsx`

### Phase 1：多轮理解与意图识别

目标：让 Agent 能理解自然语言、多轮上下文和省略表达。

修改项：

- 从 thread 中加载最近 N 轮消息作为上下文。
- 长对话生成 thread summary，避免无限塞上下文。
- 新增结构化 intent classifier。
- 用 classifier-first 替代 keyword-first。
- 保留关键词分流作为 LLM 不可用时的 fallback。
- 增加低置信度澄清路径。

建议的意图结构：

```json
{
  "intent": "health_answer | plan_generate | plan_adjust | workout_log | checkin_log | diet_log | memory_save | weekly_review | daily_guidance | location_search | unclear",
  "confidence": 0.86,
  "referenced_context": ["previous_plan", "tomorrow", "last_workout"],
  "missing_fields": [],
  "risk_flags": [],
  "should_clarify": false
}
```

验收标准：

- 至少 30 条中文多轮 golden conversations 通过。
- 能理解“按刚才那个改”“明天呢”“不要太累”“我膝盖不舒服”等表达。
- 信息不足时，优先问一个具体澄清问题。

主要文件：

- `agent/app/agents.py`
- `agent/app/models.py`
- `agent/app/session_store.py`
- `frontend/lib/api.ts`
- `frontend/app/chat/page.tsx`

### Phase 2：Planner 与工具调用闭环

目标：把 Agent 从“规则路由器”升级为“受控规划器”。

修改项：

- 新增 planner step，让模型决定是否需要读工具、读哪些工具、是否需要生成提案。
- 定义 typed tool schemas：
  - get coach summary
  - get current plan
  - get memory summary
  - get workspace summary
  - search exercises
  - search nearby places
  - create action proposal
  - confirm proposal
- 实现有上限的工具循环：

```text
Plan -> Tool Call -> Observation -> Continue or Answer
```

- 所有写动作仍然只能生成 proposal。
- 每次工具调用写入 `ToolInvocationLog`。

验收标准：

- Agent 会在回答前主动读取相关上下文。
- Agent 能说明为什么需要生成提案。
- 工具循环有最大步数、可观测、可测试。
- 写操作仍然需要用户确认。

主要文件：

- `agent/app/agents.py`
- `agent/app/tool_gateway.py`
- `agent/app/llm.py`
- `backend/src/controllers/agent-context.controller.ts`
- `backend/src/controllers/agent-commands.controller.ts`

### Phase 3：产品级训练与饮食生成

目标：替换硬编码计划和饮食模板，形成“规则约束 + LLM 生成 + 质量校验”的生成链路。

训练计划生成链路：

```text
用户画像 + 目标 + 约束 + 近期执行率 + 疲劳 + 器械 + 时间
-> 训练编排规则
-> LLM 生成草案
-> 规则校验
-> 必要时修订
-> 生成 proposal package
```

需要显式建模的训练变量：

- 目标：减脂、增肌、维持、恢复
- 训练水平：新手、中级、高级
- 每周可训练天数
- 单次训练时长
- 器械条件
- 伤病限制
- 目标肌群
- 强度和 RPE
- 渐进超负荷
- deload
- 恢复状态

饮食生成也要加入：

- 热量目标
- 蛋白质目标
- 饮食禁忌
- 过敏
- 用餐时间
- 可执行性策略
- 近期 adherence

验收标准：

- 不同目标、水平、伤病、器械、时间约束下，计划有明显差异。
- 计划调整有明确原因，而不是简单加 `(adjusted)`。
- 饮食建议不再是固定宏量营养模板。
- 不安全或证据不足的建议会被拦截或要求修订。

主要文件：

- `agent/app/agents.py`
- `backend/src/store/app-store.service.ts`
- `backend/src/services/agent-quality.service.ts`
- `backend/prisma/schema.prisma`

### Phase 4：长期记忆与个性化

目标：让 Agent 真的记住有价值的信息，并在合适的时候使用。

修改项：

- 将 memory 拆成类别：
  - 稳定画像
  - 偏好
  - 约束
  - 伤病和风险
  - 目标
  - 厌恶项
  - coaching outcome
- 对话后做 memory extraction。
- 每条 memory 保留 confidence、source message、expiry、冲突状态。
- 每次请求只检索相关 memory。
- Agent 在使用关键记忆时可以自然说明依据。

验收标准：

- Agent 能记住“膝盖不适，不想跑步”这类长期约束。
- 不会过度使用无关记忆。
- 冲突记忆会触发澄清。
- memory 更新仍然可审计。

主要文件：

- `agent/app/agents.py`
- `backend/src/store/app-store.service.ts`
- `backend/prisma/schema.prisma`
- `backend/src/controllers/agent-state.controller.ts`

### Phase 5：前端 Agent 产品体验

目标：让用户看到 Agent 的工作过程，而不是只看到短回复。

修改项：

- Chat 使用 streaming。
- 展示 tool timeline，例如“读取当前计划”“检查最近训练”“生成调整提案”。
- 澄清问题使用 chips 或聚焦输入卡片。
- 提案展示 before/after diff。
- 下一步动作在回复后保持可见。
- Chat 与 Coach Workspace 联动。
- 增加 pending proposal 提醒。

验收标准：

- 用户能看懂 Agent 正在做什么。
- 提案确认流程清晰。
- Chat 支持回答、澄清、提案、执行结果、降级模式五类状态。

主要文件：

- `frontend/app/chat/page.tsx`
- `frontend/components/agent-card.tsx`
- `frontend/components/coach-workspace-panel.tsx`
- `frontend/lib/api.ts`

### Phase 6：评测与 CI 质量门禁

目标：防止智能体验回退。

修改项：

- 新增 golden conversation fixtures。
- 新增 intent classification tests。
- 新增 tool selection tests。
- 新增 plan quality rubric tests。
- 新增 fallback mode tests。
- 新增前端 E2E：澄清、提案确认、降级模式。
- 追踪关键指标：
  - intent accuracy
  - clarification precision
  - tool success rate
  - fallback rate
  - response latency
  - proposal confirmation rate
  - user feedback score

验收标准：

- 意图识别回退时 CI 失败。
- 生成不安全提案时 CI 失败。
- LLM 静默 fallback 时 CI 失败。
- 产品指标能反映 Agent 是否真的变聪明。

主要文件：

- `agent/tests`
- `backend/src/**/*.spec.ts`
- `frontend/tests`
- `fitness-agent/docs/evals`

## 7. 推荐里程碑

### Milestone 1：停止静默降级

范围：

- LLM health check
- degraded mode
- persistent run trace
- model config cleanup

预期结果：

- 能判断短回答到底是模型失败、fallback、prompt 限制，还是业务逻辑问题。

### Milestone 2：让 Chat 有上下文

范围：

- 对话历史窗口
- thread summary
- intent classifier
- clarification path

预期结果：

- Agent 开始理解多轮上下文和模糊表达。

### Milestone 3：用 Planner 替换关键词路由

范围：

- typed tool schemas
- bounded tool loop
- read tool selection
- proposal tool creation

预期结果：

- 系统开始像 Agent 一样工作，同时保留后端安全执行边界。

### Milestone 4：升级 Coaching 生成质量

范围：

- 训练计划生成
- 饮食建议生成
- 周复盘生成
- 规则校验和自动修订

预期结果：

- 计划和建议变得个性化、可解释、可执行。

### Milestone 5：产品化交互

范围：

- streaming
- tool timeline
- proposal diff
- next actions
- workspace integration

预期结果：

- 用户能感受到 Agent 在协作，而不是只收到孤立短消息。

## 8. 非目标

- 不允许 LLM 直接写数据库。
- 不移除用户确认机制。
- 不把医学风险交给模型自由发挥。
- 不用通用模板掩盖 LLM 故障。
- 不用模型判断替代后端确定性策略。

## 9. 完成标准

这轮智能化整改完成时，系统应满足：

1. Agent 默认使用对话历史和用户上下文。
2. Agent 有可评测的结构化意图识别。
3. Agent 能在信息不足时主动澄清。
4. Agent 能通过有边界的工具调用完成读取、规划和提案。
5. 训练、饮食、复盘、调整不再依赖硬编码模板。
6. 前端能展示 Agent 状态、工具活动、提案、执行结果和降级模式。
7. CI 覆盖智能质量，而不仅是数据合同。
8. 后端策略、提案确认和审计日志继续控制所有状态改变。

## 10. 第一批可执行改动

建议先做一个小但关键的 vertical slice：

1. 增加 LLM health check 和 degraded mode。
2. 将最近 thread messages 加入 Agent 上下文。
3. 增加结构化 intent classifier。
4. 增加一个澄清问题路径。
5. 增加 10 条中文多轮对话 golden tests。

这个切片直接解决最核心的问题：Agent 回答短、像无状态接口、不能理解用户意图。同时它会为后续 planner、memory、coaching quality 打下工程基础。

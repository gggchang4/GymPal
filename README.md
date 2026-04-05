<p align="center">
  <img src="./assets/GymPal_readme_hero.jpg" alt="GymPal hero" width="100%" />
</p>

<h1 align="center">GymPal</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-14-20202A?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js 14" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5.8" />
  <img src="https://img.shields.io/badge/NestJS-API-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS API" />
  <img src="https://img.shields.io/badge/FastAPI-Agent-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI Agent" />
  <img src="https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma ORM" />
  <img src="https://img.shields.io/badge/PostgreSQL-Database-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
</p>

<p align="center">
  一个会陪你聊天、排训练、看饮食、盯恢复的健身 Agent。
</p>

<p align="center">
  不只是一个「健身记录工具」，而是一个更像训练搭子的产品原型。
</p>

---

## What Is This

`GymPal` 是一个面向中文健身场景的多服务项目，核心目标是把下面几件事串成一个连续体验：

- 和 Agent 对话，快速说出今天的状态与目标
- 获得训练建议、计划、动作库与恢复提示
- 查看饮食结构、训练日志和个人数据面板
- 为未来真实后端与模型服务预留清晰接口

现在这套仓库已经不是空壳脚手架了，而是一版可以本地跑起来的产品雏形。

## Project Layout

- `frontend/`
  Next.js App Router 前端，负责聊天、仪表盘、计划、动作库、档案、登录注册等页面
- `backend/`
  NestJS API，负责认证、资料、日志、计划、动作和仪表盘数据接口
- `agent-service/`
  Python FastAPI Agent 服务，负责对话编排、工具调用、会话管理、事件流与回放
- `assets/`
  品牌素材、Logo、README Hero 图等静态资源
- `docs/`
  补充文档和项目内说明

## Current Highlights

- Chat-first 的产品入口，Agent 对话是第一体验
- 已有完整前端界面风格和品牌视觉
- 登录注册支持纯前端 mock，并为后端接口预留切换层
- 动作库已接入本地完整目录数据，可筛选、推荐、搜索
- 饮食、训练、档案、日志和仪表盘页面已经形成一套连续产品面
- Agent 服务支持 OpenAI-compatible 调用与 SSE 流式事件

## Quick Start

### 1. 安装 Node 依赖

在项目根目录执行：

```bash
npm install
```

如果你在 Windows PowerShell 下遇到命令策略问题，可以用：

```powershell
npm.cmd install
```

### 2. 配置环境变量

复制一份环境变量模板：

```bash
cp .env.example .env
```

然后按需填写后端、数据库、模型服务相关配置。

### 3. 启动前端

在项目根目录：

```bash
npm run dev:frontend
```

或者进入前端目录：

```bash
cd frontend
npm run dev
```

默认地址：

```txt
http://localhost:3000
```

### 4. 启动后端

在项目根目录：

```bash
npm run dev:backend
```

如果你已经完成数据库配置，也可以先执行 Prisma 相关命令。

### 5. 启动 Agent Service

创建 Python 虚拟环境：

```bash
cd agent-service
python -m venv .venv
```

激活后安装依赖：

```bash
pip install -e .
```

启动服务：

```bash
uvicorn app.main:app --reload --port 8000
```

## Recommended Dev Flow

建议开 3 个终端：

1. `npm run dev:frontend`
2. `npm run dev:backend`
3. `cd agent-service && uvicorn app.main:app --reload --port 8000`

这样你可以同时调前端界面、后端接口和 Agent 对话流。

## Product Mood

GymPal 想做的不是那种冷冰冰的表单式健身工具。

它更像：

- 一个懂训练节奏的对话伙伴
- 一个会把复杂信息整理干净的健身面板
- 一个在“动作 / 饮食 / 恢复 / 计划”之间帮你建立连续感的 Agent

如果说很多健身产品像打卡器，那 GymPal 更想像一个会思考的训练搭子。

## Notes

- 后端现在使用 Prisma + PostgreSQL，而不是纯内存 mock
- 前端部分模块支持 mock 与 API 双实现切换
- Agent 服务在没有模型凭证时可以退回到确定性演示模式
- 用户可见的 reasoning 只会展示整理后的摘要，不暴露原始链路推理

## License

See [LICENSE](../LICENSE).

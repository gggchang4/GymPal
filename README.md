<p align="center">
  <img src="./fitness-agent/assets/GymPal_readme_hero.jpg" alt="GymPal hero" width="100%" />
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
  它不只是健身记录工具，更像一个会思考的训练搭子。
</p>

---

## What Is GymPal

`GymPal` 是一个面向中文健身场景的多服务项目原型，想把这些体验串成一条完整链路：

- 和 Agent 对话，快速表达今天的状态与目标
- 获取训练建议、计划安排、动作库检索和恢复提示
- 查看饮食结构、训练日志、档案与仪表盘
- 为未来真实后端与模型服务预留稳定接口

## Project Structure

- `health-agent/frontend/`
  Next.js App Router 前端，负责聊天、仪表盘、动作库、饮食、档案、计划、登录注册等页面
- `health-agent/backend/`
  NestJS API，负责认证、资料、日志、计划、动作和仪表盘数据接口
- `health-agent/agent-service/`
  Python FastAPI Agent 服务，负责对话编排、工具调用、会话管理和流式事件
- `health-agent/assets/`
  品牌素材、README hero、Logo 等静态资源

## Current Highlights

- Chat-first 的产品入口，Agent 对话是第一体验
- 统一的 GymPal 品牌视觉和页面设计语言
- 前端登录注册支持 mock，并为后端接口预留切换层
- 动作库支持完整目录、筛选、推荐和检索
- Agent 服务支持 OpenAI-compatible 调用和 SSE 流式事件

## Quick Start

在项目目录下启动：

```bash
cd health-agent
npm install
```

启动前端：

```bash
npm run dev:frontend
```

启动后端：

```bash
npm run dev:backend
```

启动 Agent Service：

```bash
cd agent-service
python -m venv .venv
pip install -e .
uvicorn app.main:app --reload --port 8000
```

前端默认地址：

```txt
http://localhost:3000
```

## Recommended Dev Flow

建议开 3 个终端：

1. `npm run dev:frontend`
2. `npm run dev:backend`
3. `cd agent-service && uvicorn app.main:app --reload --port 8000`

这样可以同时调前端界面、后端接口和 Agent 对话流。

## Notes

- 后端当前使用 Prisma + PostgreSQL
- 前端部分模块支持 mock 与 API 双实现切换
- Agent 服务在没有模型凭证时可以退回到演示模式
- 用户可见 reasoning 只展示整理后的摘要，不暴露原始链路推理

## License

See [LICENSE](./LICENSE).

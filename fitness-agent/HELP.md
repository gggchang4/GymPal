# Fitness Agent Help

This file is the practical setup and troubleshooting guide for teammates working on `fitness-agent`.

It covers:
- what this project needs locally
- how to initialize PostgreSQL
- how to configure the agent `.env`
- how to launch frontend, backend, and agent
- how to verify that PostgreSQL and the LLM are really being used
- what work has already been completed in this repo

## Project Structure

- `frontend`
  - Next.js app for the user interface
  - main chat page: [frontend/app/chat/page.tsx](/d:/86158/Project/agent/fitness-agent/frontend/app/chat/page.tsx)
- `backend`
  - NestJS API
  - Prisma + PostgreSQL
- `agent`
  - FastAPI agent runtime
  - calls backend tools and the external LLM provider

Runtime flow:

`Frontend -> Agent -> Backend -> PostgreSQL`

and when LLM is available:

`Agent -> LLM Provider`

## Architecture Diagram

### 1. Standard app pages

Pages like `dashboard`, `profile`, `logs`, `plans`, and `exercises` use this path:

```text
Frontend page
  -> frontend/lib/api.ts
  -> NestJS backend controller
  -> app-store.service.ts
  -> Prisma
  -> PostgreSQL
  -> Backend JSON response
  -> Frontend render
```

This means the frontend does not read PostgreSQL directly. It always goes through the backend API first.

### 2. Chat / agent flow

The chat page uses this longer path:

```text
User message in /chat
  -> Frontend chat page
  -> FastAPI agent
  -> tool_gateway.py
  -> NestJS backend
  -> Prisma
  -> PostgreSQL
  -> agent gathers real user context
  -> LLM provider
  -> agent formats final reply
  -> Frontend chat render
```

### 3. Responsibility of each layer

- `Frontend`
  - shows UI
  - sends requests
  - renders backend data and agent replies
- `Agent`
  - reasoning layer for multi-turn chat
  - fetches real app context from backend tools
  - calls the LLM and turns structured context into a coaching reply
- `Backend`
  - application API and business rules
  - validates requests
  - reads and writes persistent fitness data
- `Prisma`
  - ORM layer between backend and PostgreSQL
  - maps TypeScript service calls to SQL queries
- `PostgreSQL`
  - persistent source of truth
  - stores users, profiles, check-ins, body metrics, workout logs, plans, and exercises
- `LLM Provider`
  - generates the final natural-language answer
  - should not be treated as the source of truth for product data

### 4. Simple rule to remember

- normal pages:
  - `Frontend -> Backend -> PostgreSQL`
- chat:
  - `Frontend -> Agent -> Backend -> PostgreSQL -> Agent -> LLM -> Frontend`

## Local Requirements

Each teammate should have:

- Node.js
- npm
- PostgreSQL
- Python 3.10+
- one usable Python environment for the agent

This project currently uses:

- frontend: Next.js + React + TypeScript
- backend: NestJS + Prisma + PostgreSQL
- agent: FastAPI + httpx + OpenAI-compatible SDK

## PostgreSQL Setup

### 0. Local `.env` files are not shared through Git

Each teammate must create their own local `.env` files.

This is expected because:

- real database passwords should not be committed
- real LLM/API keys should not be committed
- local machine URLs and secrets may differ across teammates

Files that should stay local:

- [backend/.env](/d:/86158/Project/agent/fitness-agent/backend/.env)
- [agent/.env](/d:/86158/Project/agent/fitness-agent/agent/.env)

Shared template:

- [`.env.example`](/d:/86158/Project/agent/fitness-agent/.env.example)

Recommended setup for a new teammate:

1. open [`.env.example`](/d:/86158/Project/agent/fitness-agent/.env.example)
2. copy the needed values into local files:
   - [backend/.env](/d:/86158/Project/agent/fitness-agent/backend/.env)
   - [agent/.env](/d:/86158/Project/agent/fitness-agent/agent/.env)
3. replace placeholder values like:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `LLM_API_KEY`
   - `AMAP_API_KEY` if needed

If a teammate is missing a local `.env`, the backend or agent may fail to start, or the LLM may fail with auth/config errors.

### 0.1 Exact copy guide

Copy these lines into [backend/.env](/d:/86158/Project/agent/fitness-agent/backend/.env):

```env
BACKEND_PORT=3001
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/health_agent
JWT_SECRET=replace-me-with-a-local-secret
```

Copy these lines into [agent/.env](/d:/86158/Project/agent/fitness-agent/agent/.env):

```env
BACKEND_BASE_URL=http://localhost:3001
LLM_MODEL_ID=deepseek-v4-flash
LLM_API_KEY=YOUR_DEEPSEEK_API_KEY
LLM_BASE_URL=https://api.deepseek.com
LLM_TIMEOUT=20
LLM_TEMPERATURE=0.3
LLM_MAX_TOKENS=1200
LLM_MAX_RETRIES=2
AMAP_API_KEY=
```

Optional frontend local env values, only if your frontend setup needs them:

```env
FRONTEND_PORT=3000
AGENT_SERVICE_PORT=8000
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_AGENT_URL=http://localhost:8000
```

Simple rule:

- `backend/.env`
  - database connection
  - backend port
  - JWT/auth secret
- `agent/.env`
  - backend base URL
  - LLM provider URL
  - LLM API key
  - model ID
  - map API key if used

### 1. Create the local database

Create a PostgreSQL database named:

`health_agent`

Example connection used in this project:

```env
postgresql://postgres:YOUR_PASSWORD@localhost:5432/health_agent
```

### 2. Configure backend database connection

Create or update:

- [backend/.env](/d:/86158/Project/agent/fitness-agent/backend/.env)

Example:

```env
BACKEND_PORT=3001
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/health_agent
```

### 3. Initialize schema and seed data

From the project root:

```powershell
cd D:\86158\Project\agent\fitness-agent
npm run db:migrate:resolve:init
npm run db:migrate:deploy
npm run db:seed
```

Explanation:

- `db:migrate:resolve:init`
  - marks the existing initial migration as applied if the local DB already has tables
- `db:migrate:deploy`
  - applies committed Prisma migrations
- `db:seed`
  - regenerates Prisma client and seeds shared local demo/reference data

### 4. If you want a completely fresh DB

If your local database is broken and you want to rebuild from zero:

1. drop the `health_agent` database
2. recreate it empty
3. run:

```powershell
cd D:\86158\Project\agent\fitness-agent
npm run db:init
```

## How To Check PostgreSQL Data

### Option 1: `psql`

```powershell
& 'D:\86158\database\sql\bin\psql.exe' -h localhost -U postgres -d health_agent
```

Useful commands inside `psql`:

```sql
\dt
\d "User"
\d "DailyCheckin"
\d "WorkoutPlan"
```

Useful queries:

```sql
SELECT * FROM "User";
SELECT * FROM "HealthProfile";
SELECT * FROM "BodyMetricLog" ORDER BY "recordedAt" DESC;
SELECT * FROM "DailyCheckin" ORDER BY "recordedAt" DESC;
SELECT * FROM "WorkoutLog" ORDER BY "recordedAt" DESC;
SELECT * FROM "WorkoutPlan";
SELECT * FROM "WorkoutPlanDay";
SELECT * FROM "DietRecommendationSnapshot";
SELECT * FROM "Exercise";
SELECT * FROM "ExerciseVariant";
```

Exit:

```sql
\q
```

### Option 2: Prisma Studio

```powershell
cd D:\86158\Project\agent\fitness-agent
npm run db:studio
```

## Backend Launch

Start the Nest backend from the project root:

```powershell
cd D:\86158\Project\agent\fitness-agent
npm run dev:backend
```

Expected backend URL:

`http://localhost:3001`

Quick health-style checks:

- [http://localhost:3001/me](http://localhost:3001/me)
- [http://localhost:3001/dashboard](http://localhost:3001/dashboard)
- [http://localhost:3001/exercises](http://localhost:3001/exercises)

### Backend terminal signals to watch

You should see logs such as:

- `Connected to PostgreSQL via Prisma.`
- `Loaded user from PostgreSQL ...`
- `Loaded 4 daily check-in record(s) from PostgreSQL ...`
- `Loaded current workout plan from PostgreSQL ...`

These prove the backend is really loading data from PostgreSQL.

## Frontend Launch

Start the frontend from the project root:

```powershell
cd D:\86158\Project\agent\fitness-agent
npm run dev:frontend
```

Expected frontend URL:

`http://localhost:3000`

Main user-facing chat page:

- [http://localhost:3000/chat](http://localhost:3000/chat)

## Agent Environment Setup

The agent runtime loads environment variables from:

- [agent/.env](/d:/86158/Project/agent/fitness-agent/agent/.env)

Current important fields:

```env
BACKEND_BASE_URL=http://localhost:3001
LLM_MODEL_ID=deepseek-v4-flash
LLM_API_KEY=YOUR_DEEPSEEK_API_KEY
LLM_BASE_URL=https://api.deepseek.com
LLM_TIMEOUT=20
LLM_TEMPERATURE=0.3
LLM_MAX_TOKENS=1200
LLM_MAX_RETRIES=2
AMAP_API_KEY=
```

Notes:

- `BACKEND_BASE_URL`
  - must point to the Nest backend
- `LLM_BASE_URL`
  - must match the provider
- `LLM_API_KEY`
  - must be valid for that provider
- `LLM_MODEL_ID`
  - must be available on that provider
- `AMAP_API_KEY`
  - optional
  - only needed for live nearby-place search

Security note:

- Never commit a real API key.
- If a key has been exposed in terminal history or screenshots, rotate it.

## Agent Launch

This repo has had confusion between a local `.venv` and a conda environment. The stable working path currently uses the conda environment directly.

Activate the Python environment:

```powershell
conda activate D:\application\pymol\envs\health-agent
```

Then start the agent:

```powershell
cd D:\86158\Project\agent\fitness-agent\agent
python -m pip install -e .
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Expected agent URL:

`http://localhost:8000`

Quick check:

```powershell
Invoke-WebRequest http://localhost:8000/healthz -UseBasicParsing
```

Expected:

```json
{"status":"ok"}
```

## How To Verify The Full Stack Is Working

When you send a message in the chat page, the ideal path is:

`frontend -> agent -> backend -> PostgreSQL -> agent -> LLM -> frontend`

### What to watch in the agent terminal

You should see:

- `[AGENT] Frontend message received ...`
- `[TOOLS] Requesting recent health data from backend ...`
- `[TOOLS] ... loaded successfully from PostgreSQL-backed API.`
- `[LLM] Sending structured request to ...`
- `[LLM] Structured response received from model=...`
- `[AGENT] LLM response accepted for mode=...`

This means:

- the chat request reached the agent
- the agent fetched real backend data
- the agent really called the external LLM
- the LLM really returned a response

### What to watch in the backend terminal

You should see:

- `Connected to PostgreSQL via Prisma.`
- `Loaded user from PostgreSQL ...`
- `Loaded ... record(s) from PostgreSQL ...`

This proves the backend is not using frontend static data. It is reading real PostgreSQL rows.

## Common Problems

### 1. Frontend says it cannot reach backend

Symptom:

- `Unable to reach the backend API at http://localhost:3001`

Fix:

- start backend with `npm run dev:backend`

### 2. Frontend says it cannot reach agent

Symptom:

- `Unable to reach the agent service at http://localhost:8000`

Fix:

- start the FastAPI agent

### 3. Prisma migration says database is not empty

Symptom:

- `P3005 The database schema is not empty`

Fix:

```powershell
cd D:\86158\Project\agent\fitness-agent
npm run db:migrate:resolve:init
npm run db:migrate:deploy
npm run db:seed
```

### 4. Seed script fails

Possible fix:

```powershell
cd D:\86158\Project\agent\fitness-agent
npm run db:generate
npm run db:seed
```

The backend `db:seed` command was updated to generate Prisma client before seeding.

### 5. Agent returns HTTP 200 but reply is not real LLM output

This can happen if:

- the provider rejects the request
- the model is rate-limited
- auth fails
- the network fails

The agent no longer returns fake coaching text for LLM failure. It now returns explicit error-style content so teammates do not mistake fallback content for real model output.

### 6. OpenRouter free model is unstable

If your configured LLM provider is rate-limited:

- retry later
- switch to another provider/model
- or use a paid/provider-owned key for stability

### 7. Chat page could not send multiple rounds

This was a frontend state bug, especially visible in React dev mode.

The chat page was fixed so:

- internal debug panels were removed from the user UI
- the composer no longer gets stuck waiting on the old stream/debug flow
- dev-mode mount behavior no longer leaves the button stuck on `Sending...`

If the page still behaves strangely after pulling the latest code:

```powershell
cd D:\86158\Project\agent\fitness-agent
npm run dev:frontend
```

Then do a hard refresh in the browser.

## Team Workflow Notes

Source of truth for schema:

- [backend/prisma/schema.prisma](/d:/86158/Project/agent/fitness-agent/backend/prisma/schema.prisma)

Source of truth for schema history:

- [backend/prisma/migrations](/d:/86158/Project/agent/fitness-agent/backend/prisma/migrations)

Shared local/demo seed:

- [backend/prisma/seed.mjs](/d:/86158/Project/agent/fitness-agent/backend/prisma/seed.mjs)

Important rule:

- Never treat manual local DB edits as the source of truth.
- If a schema change matters, it must end up in:
  - `schema.prisma`
  - a committed migration

Recommended team flow:

1. edit `schema.prisma`
2. create Prisma migration
3. commit migration + schema changes
4. teammates pull
5. teammates run migration + seed locally

chat page:
![alt text](image.png)
postgresql local database:
![alt text](image-1.png)
request to LLM and response from LLM:
![alt text](image-2.png)

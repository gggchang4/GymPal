from __future__ import annotations

import base64
import json
import logging

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .agents import HealthAgentRuntime
from .config import settings
from .llm import OpenAICompatibleLLMClient
from .models import (
    CreateThreadRequest,
    CreateThreadResponse,
    FeedbackRequest,
    PostMessageRequest,
    ProposalDecisionResponse,
    RecommendationFeedbackRequest,
)
from .session_store import SessionStore
from .tool_gateway import ToolGateway
from .trace_logger import TraceLogger

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
)

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

session_store = SessionStore()
tool_gateway = ToolGateway()
trace_logger = TraceLogger()
llm_client = OpenAICompatibleLLMClient()
runtime = HealthAgentRuntime(session_store, tool_gateway, trace_logger, llm_client)


def require_authorization_header(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authentication required.")

    return authorization


async def get_authenticated_user_id(authorization: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{settings.backend_base_url}/me",
                headers={"Authorization": authorization},
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail="Authentication failed.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Unable to validate authentication.") from exc

    user_id = payload.get("id")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=401, detail="Authentication failed.")

    return user_id


def extract_user_id_from_authorization(authorization: str | None) -> str | None:
    if not authorization:
        return None

    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0] != "Bearer":
        return None

    token_parts = parts[1].split(".")
    if len(token_parts) != 3:
        return None

    payload = token_parts[1]
    padding = "=" * (-len(payload) % 4)

    try:
        decoded = base64.urlsafe_b64decode(payload + padding).decode("utf-8")
        parsed = json.loads(decoded)
    except Exception:
        return None

    subject = parsed.get("sub")
    return str(subject) if isinstance(subject, str) and subject else None


@app.get("/healthz")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/agent/threads", response_model=CreateThreadResponse)
async def create_thread(payload: CreateThreadRequest, authorization: str | None = Header(default=None)) -> CreateThreadResponse:
    thread = await session_store.create_thread(payload.title, require_authorization_header(authorization))
    return CreateThreadResponse(thread_id=thread.id)


@app.get("/agent/threads/{thread_id}/messages")
async def list_messages(thread_id: str, authorization: str | None = Header(default=None)):
    return await session_store.list_messages(thread_id, require_authorization_header(authorization))


@app.get("/agent/threads/{thread_id}/proposals")
async def list_proposals(thread_id: str, authorization: str | None = Header(default=None)):
    return await session_store.list_proposals(thread_id, require_authorization_header(authorization))


@app.get("/agent/threads/{thread_id}/review-state")
async def get_review_state(thread_id: str, authorization: str | None = Header(default=None)):
    return await session_store.get_review_state(thread_id, require_authorization_header(authorization))


@app.get("/agent/threads/{thread_id}/memory-state")
async def get_memory_state(thread_id: str, authorization: str | None = Header(default=None)):
    return await session_store.get_memory_state(thread_id, require_authorization_header(authorization))


@app.post("/agent/threads/{thread_id}/messages")
async def post_message(
    thread_id: str,
    payload: PostMessageRequest,
    authorization: str | None = Header(default=None),
):
    return await runtime.process_message(thread_id, payload, require_authorization_header(authorization))


@app.post("/agent/proposals/{proposal_id}/approve", response_model=ProposalDecisionResponse)
async def approve_proposal(proposal_id: str, authorization: str | None = Header(default=None)):
    return await runtime.approve_proposal(proposal_id, require_authorization_header(authorization))


@app.post("/agent/proposals/{proposal_id}/reject", response_model=ProposalDecisionResponse)
async def reject_proposal(proposal_id: str, authorization: str | None = Header(default=None)):
    return await runtime.reject_proposal(proposal_id, require_authorization_header(authorization))


@app.post("/agent/proposal-groups/{proposal_group_id}/approve", response_model=ProposalDecisionResponse)
async def approve_proposal_group(proposal_group_id: str, authorization: str | None = Header(default=None)):
    return await runtime.approve_proposal_group(proposal_group_id, require_authorization_header(authorization))


@app.post("/agent/proposal-groups/{proposal_group_id}/reject", response_model=ProposalDecisionResponse)
async def reject_proposal_group(proposal_group_id: str, authorization: str | None = Header(default=None)):
    return await runtime.reject_proposal_group(proposal_group_id, require_authorization_header(authorization))


@app.get("/agent/runs/{run_id}/stream")
async def stream_run(run_id: str, authorization: str | None = Header(default=None)):
    try:
        run = await session_store.get_run(run_id, require_authorization_header(authorization))
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=404, detail="Run not found") from exc

    async def event_generator():
        for step in run["steps"]:
            yield f"event: {step['step_type']}\n"
            yield f"data: {json.dumps(step, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/agent/runs/{run_id}/feedback")
async def submit_feedback(run_id: str, payload: FeedbackRequest, authorization: str | None = Header(default=None)):
    normalized_authorization = require_authorization_header(authorization)
    try:
        await session_store.get_run(run_id, normalized_authorization)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail="Run not found") from exc
    session_store.add_feedback(run_id, payload.model_dump())
    return {"ok": True}


@app.post("/agent/feedback/recommendation")
async def submit_recommendation_feedback(
    payload: RecommendationFeedbackRequest,
    authorization: str | None = Header(default=None),
):
    body = {
        "reviewSnapshotId": payload.review_snapshot_id,
        "proposalGroupId": payload.proposal_group_id,
        "feedbackType": payload.feedback_type,
        "note": payload.note,
    }
    return await session_store.create_recommendation_feedback(body, require_authorization_header(authorization))


@app.get("/agent/traces")
async def list_traces(authorization: str | None = Header(default=None)):
    normalized_authorization = require_authorization_header(authorization)
    user_id = await get_authenticated_user_id(normalized_authorization)
    return trace_logger.list_records(user_id)

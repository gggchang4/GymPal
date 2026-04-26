from __future__ import annotations

from typing import Any

import httpx

from .config import settings
from .models import MessageRecord, RunRecord, ThreadRecord


class SessionStore:
    def __init__(self) -> None:
        self._feedback: dict[str, list[dict[str, Any]]] = {}

    @staticmethod
    def _headers(authorization: str | None) -> dict[str, str]:
        return {"Authorization": authorization} if authorization else {}

    async def create_thread(self, title: str | None = None, authorization: str | None = None) -> ThreadRecord:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/threads",
                headers=self._headers(authorization),
                json={"title": title},
            )
            response.raise_for_status()
            payload = response.json()
            return ThreadRecord(
                id=payload["id"],
                title=payload.get("title") or title or "Health Agent Chat",
            )

    async def append_message(
        self,
        thread_id: str,
        message: MessageRecord,
        authorization: str | None = None,
    ) -> MessageRecord:
        body = {
            "role": message.role,
            "content": message.content,
            "reasoning": message.reasoning_summary,
            "cards": [card.model_dump(mode="json") for card in message.cards],
        }
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/threads/{thread_id}/messages",
                headers=self._headers(authorization),
                json=body,
            )
            response.raise_for_status()
            payload = response.json()
            return MessageRecord(
                id=payload["id"],
                role=payload["role"],
                content=payload["content"],
                reasoning_summary=payload.get("reasoning_summary"),
                cards=message.cards,
            )

    async def list_messages(self, thread_id: str, authorization: str | None = None) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{settings.backend_base_url}/agent/state/threads/{thread_id}/messages",
                headers=self._headers(authorization),
            )
            response.raise_for_status()
            return response.json()

    async def save_run(self, run: RunRecord, authorization: str | None = None) -> RunRecord:
        body = {
            "id": run.id,
            "status": run.status,
            "risk_level": run.risk_level,
            "steps": [
                {
                    "id": step.id,
                    "step_type": step.step_type,
                    "title": step.title,
                    "payload": step.payload,
                }
                for step in run.steps
            ],
        }
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/threads/{run.thread_id}/runs",
                headers=self._headers(authorization),
                json=body,
            )
            response.raise_for_status()
        return run

    async def get_run(self, run_id: str, authorization: str | None = None) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{settings.backend_base_url}/agent/state/runs/{run_id}",
                headers=self._headers(authorization),
            )
            response.raise_for_status()
            return response.json()

    async def create_proposals(
        self,
        thread_id: str,
        run_id: str,
        proposals: list[dict[str, Any]],
        authorization: str | None = None,
    ) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/threads/{thread_id}/proposals",
                headers=self._headers(authorization),
                json={"runId": run_id, "proposals": proposals},
            )
            response.raise_for_status()
            return response.json()

    async def create_coaching_package(
        self,
        thread_id: str,
        payload: dict[str, Any],
        authorization: str | None = None,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/threads/{thread_id}/coaching-package",
                headers=self._headers(authorization),
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def create_coaching_review(
        self,
        thread_id: str,
        payload: dict[str, Any],
        authorization: str | None = None,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/threads/{thread_id}/reviews",
                headers=self._headers(authorization),
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def list_coaching_reviews(self, thread_id: str, authorization: str | None = None) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{settings.backend_base_url}/agent/state/threads/{thread_id}/reviews",
                headers=self._headers(authorization),
            )
            response.raise_for_status()
            return response.json()

    async def create_proposal_group(
        self,
        thread_id: str,
        payload: dict[str, Any],
        authorization: str | None = None,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/threads/{thread_id}/proposal-groups",
                headers=self._headers(authorization),
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def list_proposal_groups(self, thread_id: str, authorization: str | None = None) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{settings.backend_base_url}/agent/state/threads/{thread_id}/proposal-groups",
                headers=self._headers(authorization),
            )
            response.raise_for_status()
            return response.json()

    async def get_proposal_group(self, proposal_group_id: str, authorization: str | None = None) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{settings.backend_base_url}/agent/state/proposal-groups/{proposal_group_id}",
                headers=self._headers(authorization),
            )
            response.raise_for_status()
            return response.json()

    async def list_proposals(self, thread_id: str, authorization: str | None = None) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{settings.backend_base_url}/agent/state/threads/{thread_id}/proposals",
                headers=self._headers(authorization),
            )
            response.raise_for_status()
            return response.json()

    async def get_proposal(self, proposal_id: str, authorization: str | None = None) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{settings.backend_base_url}/agent/state/proposals/{proposal_id}",
                headers=self._headers(authorization),
            )
            response.raise_for_status()
            return response.json()

    async def approve_proposal(self, proposal_id: str, authorization: str | None = None) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/proposals/{proposal_id}/approve",
                headers=self._headers(authorization),
                json={"proposalId": proposal_id},
            )
            response.raise_for_status()
            return response.json()

    async def reject_proposal(self, proposal_id: str, authorization: str | None = None) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/proposals/{proposal_id}/reject",
                headers=self._headers(authorization),
                json={"proposalId": proposal_id},
            )
            response.raise_for_status()
            return response.json()

    async def reject_proposal_group(self, proposal_group_id: str, authorization: str | None = None) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/proposal-groups/{proposal_group_id}/reject",
                headers=self._headers(authorization),
                json={"proposalId": proposal_group_id},
            )
            response.raise_for_status()
            return response.json()

    async def confirm_proposal(self, proposal_id: str, idempotency_key: str, authorization: str | None = None) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/proposals/{proposal_id}/confirm",
                headers=self._headers(authorization),
                json={"idempotencyKey": idempotency_key},
            )
            response.raise_for_status()
            return response.json()

    async def confirm_proposal_group(
        self,
        proposal_group_id: str,
        idempotency_key: str,
        authorization: str | None = None,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{settings.backend_base_url}/agent/state/proposal-groups/{proposal_group_id}/confirm",
                headers=self._headers(authorization),
                json={"idempotencyKey": idempotency_key},
            )
            response.raise_for_status()
            return response.json()

    def add_feedback(self, run_id: str, feedback: dict[str, Any]) -> None:
        self._feedback.setdefault(run_id, []).append(feedback)

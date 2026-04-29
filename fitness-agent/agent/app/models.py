from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


CardType = Literal[
    "health_advice_card",
    "workout_plan_card",
    "exercise_card",
    "recovery_card",
    "place_result_card",
    "reasoning_summary_card",
    "tool_activity_card",
    "action_proposal_card",
    "action_result_card",
    "weekly_review_card",
    "daily_guidance_card",
    "coaching_package_card",
    "evidence_card",
    "memory_candidate_card",
    "outcome_summary_card",
    "strategy_decision_card",
    "work_item_card",
    "quality_check_card",
    "revision_card",
    "coach_workspace_card",
]


class Card(BaseModel):
    type: CardType
    title: str
    description: str
    bullets: list[str] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)


class ToolResponse(BaseModel):
    ok: bool
    data: dict[str, Any] = Field(default_factory=dict)
    human_readable: str
    source: str
    error_code: str | None = None
    retryable: bool = False


class ToolEvent(BaseModel):
    event: Literal["tool_call_started", "tool_call_completed"]
    tool_name: str
    summary: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MessageRecord(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    reasoning_summary: str | None = None
    cards: list[Card] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RunStep(BaseModel):
    id: str
    step_type: Literal["thinking_summary", "tool_call_started", "tool_call_completed", "card_render", "final_message"]
    title: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RunRecord(BaseModel):
    id: str
    thread_id: str
    status: Literal["completed", "failed"] = "completed"
    risk_level: Literal["low", "medium", "high"] = "low"
    steps: list[RunStep] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ThreadRecord(BaseModel):
    id: str
    title: str = "Health Agent Chat"
    summary: str | None = None
    messages: list[MessageRecord] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CreateThreadRequest(BaseModel):
    title: str | None = None


class CreateThreadResponse(BaseModel):
    thread_id: str


class PostMessageRequest(BaseModel):
    text: str
    location_hint: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class PostMessageResponse(BaseModel):
    id: str
    role: Literal["assistant"] = "assistant"
    content: str
    reasoning_summary: str
    cards: list[Card] = Field(default_factory=list)
    run_id: str
    tool_events: list[ToolEvent] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    risk_level: Literal["low", "medium", "high"] = "low"


class ActionProposal(BaseModel):
    action_type: str
    entity_type: str
    entity_id: str | None = None
    title: str
    summary: str
    payload: dict[str, Any] = Field(default_factory=dict)
    preview: dict[str, Any] = Field(default_factory=dict)
    risk_level: Literal["low", "medium", "high"] = "low"
    requires_confirmation: bool = True
    validation_warnings: list[str] = Field(default_factory=list)


class ProposalDecisionResponse(BaseModel):
    id: str
    role: Literal["assistant"] = "assistant"
    content: str
    reasoning_summary: str
    cards: list[Card] = Field(default_factory=list)
    proposal_id: str
    status: str
    proposal_group_id: str | None = None


class FeedbackRequest(BaseModel):
    helpful: bool
    note: str | None = None


class RecommendationFeedbackRequest(BaseModel):
    review_snapshot_id: str | None = None
    proposal_group_id: str | None = None
    feedback_type: Literal["helpful", "too_hard", "too_easy", "not_relevant", "unsafe_or_uncomfortable", "unclear"]
    note: str | None = None

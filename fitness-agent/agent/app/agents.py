from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Any

from .config import settings
from .llm import OpenAICompatibleLLMClient
from .models import Card, MessageRecord, PostMessageRequest, PostMessageResponse, ProposalDecisionResponse, RunRecord, RunStep, ToolEvent
from .session_store import SessionStore
from .tool_gateway import ToolGateway, compute_place_rank
from .trace_logger import TraceLogger


logger = logging.getLogger("health_agent.runtime")


class HealthAgentRuntime:
    ACTION_TYPES = {
        "generate_plan",
        "adjust_plan",
        "create_plan_day",
        "update_plan_day",
        "delete_plan_day",
        "complete_plan_day",
        "create_body_metric",
        "create_daily_checkin",
        "create_workout_log",
        "generate_next_week_plan",
        "generate_diet_snapshot",
        "create_advice_snapshot",
        "create_coaching_memory",
        "update_coaching_memory",
        "archive_coaching_memory",
    }

    LOCATION_KEYWORDS = ("附近", "周围", "公园", "步道", "游泳", "健身房", "gym", "park")
    PLAN_KEYWORDS = ("计划", "安排", "本周", "下周", "todo", "待办", "训练日", "plan")
    EXERCISE_KEYWORDS = ("动作", "替代", "深蹲", "卧推", "拉伸", "exercise")
    HIGH_RISK_KEYWORDS = ("胸痛", "晕厥", "处方", "药物", "极端减肥")
    WEEKLY_REVIEW_KEYWORDS = ("复盘", "本周总结", "下周安排", "下周计划", "weekly review", "next week")
    DAILY_GUIDANCE_KEYWORDS = (
        "今日建议",
        "今日训练建议",
        "今天的训练建议",
        "今天该不该练",
        "今天怎么练",
        "恢复建议",
        "恢复状态",
        "daily guidance",
        "today",
    )

    def __init__(
        self,
        store: SessionStore,
        tool_gateway: ToolGateway,
        trace_logger: TraceLogger,
        llm: OpenAICompatibleLLMClient,
    ) -> None:
        self.store = store
        self.tools = tool_gateway
        self.trace = trace_logger
        self.llm = llm

    @staticmethod
    def _detect_reply_language(user_text: str) -> str:
        if any("\u4e00" <= char <= "\u9fff" for char in user_text):
            return "Simplified Chinese"
        return "English"

    @staticmethod
    def _tool_payload(tool_response) -> dict[str, Any]:
        payload = dict(tool_response.data)
        if not tool_response.ok:
            if tool_response.error_code:
                payload["error_code"] = tool_response.error_code
            payload["retryable"] = tool_response.retryable
        return payload

    @staticmethod
    def _preview_to_bullets(preview: dict[str, Any]) -> list[str]:
        bullets: list[str] = []
        for key, value in preview.items():
            if isinstance(value, list):
                rendered = " / ".join(str(item) for item in value[:4])
            elif isinstance(value, dict):
                rendered = ", ".join(f"{sub_key}: {sub_value}" for sub_key, sub_value in list(value.items())[:4])
            else:
                rendered = str(value)
            bullets.append(f"{key}: {rendered}")
        return bullets[:5]

    @staticmethod
    def _coerce_text_list(value: Any, fallback: list[str]) -> list[str]:
        if not isinstance(value, list):
            return fallback
        items = [str(item).strip() for item in value if str(item).strip()]
        return items[:3] or fallback

    @staticmethod
    def _dedupe_text_items(items: list[str]) -> list[str]:
        deduped: list[str] = []
        seen: set[str] = set()
        for item in items:
            normalized = str(item).strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(normalized)
        return deduped

    @staticmethod
    def _extract_number(patterns: list[str], text: str) -> float | None:
        for pattern in patterns:
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                try:
                    return float(match.group(1))
                except ValueError:
                    return None
        return None

    @staticmethod
    def _extract_day_label(text: str, plan_days: list[dict[str, Any]]) -> dict[str, Any] | None:
        lowered = text.lower()
        for day in plan_days:
            day_label = str(day.get("dayLabel") or day.get("day_label") or "").strip()
            focus = str(day.get("focus") or "").strip()
            if day_label and (day_label in text or day_label.lower() in lowered):
                return day
            if focus and focus in text:
                return day
        return None

    @staticmethod
    def _normalize_focus_from_text(text: str, fallback: str) -> str:
        cleaned = re.sub(r"[，。！？,.!?]", " ", text).strip()
        cleaned = re.sub(r"\s+", " ", cleaned)
        return cleaned[:48] if cleaned else fallback

    def _proposal_title(self, action_type: str) -> str:
        title_map = {
            "generate_plan": "生成新训练计划",
            "adjust_plan": "调整当前训练计划",
            "create_plan_day": "新增训练计划项",
            "update_plan_day": "更新训练计划项",
            "delete_plan_day": "删除训练计划项",
            "complete_plan_day": "更新计划完成状态",
            "create_body_metric": "记录身体指标",
            "create_daily_checkin": "记录每日打卡",
            "create_workout_log": "记录训练日志",
            "generate_next_week_plan": "生成下周训练计划",
            "generate_diet_snapshot": "生成饮食建议快照",
            "create_advice_snapshot": "生成行为建议快照",
            "create_coaching_memory": "新增教练记忆",
            "update_coaching_memory": "更新教练记忆",
            "archive_coaching_memory": "归档教练记忆",
        }
        return title_map.get(action_type, "待确认操作")

    @staticmethod
    def _extract_user_id_from_authorization(authorization: str | None) -> str | None:
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

    def _risk_for_action(self, action_type: str) -> str:
        if action_type in {"generate_plan", "adjust_plan", "delete_plan_day", "generate_next_week_plan", "generate_diet_snapshot"}:
            return "high"
        if action_type in {"update_plan_day", "create_workout_log", "create_advice_snapshot", "create_coaching_memory", "update_coaching_memory", "archive_coaching_memory"}:
            return "medium"
        return "low"

    @staticmethod
    def _max_risk_level(levels: list[str]) -> str:
        ranking = {"low": 0, "medium": 1, "high": 2}
        return max(levels, key=lambda level: ranking.get(level, 0), default="low")

    def _is_location_query(self, text: str) -> bool:
        lowered = text.lower()
        return any(keyword in text for keyword in self.LOCATION_KEYWORDS) or any(
            keyword in lowered for keyword in ("nearby", "location", "where can i train")
        )

    def _is_exercise_query(self, text: str) -> bool:
        lowered = text.lower()
        return any(keyword in text for keyword in self.EXERCISE_KEYWORDS) or "exercise" in lowered

    def _is_plan_query(self, text: str) -> bool:
        lowered = text.lower()
        return any(keyword in text for keyword in self.PLAN_KEYWORDS) or "plan" in lowered

    def _is_weekly_review_request(self, text: str) -> bool:
        lowered = text.lower()
        return any(keyword in text for keyword in self.WEEKLY_REVIEW_KEYWORDS) or "weekly review" in lowered

    def _is_daily_guidance_request(self, text: str) -> bool:
        lowered = text.lower()
        return any(keyword in text for keyword in self.DAILY_GUIDANCE_KEYWORDS) or "daily guidance" in lowered

    def _detect_write_domain(self, text: str) -> str | None:
        lowered = text.lower()
        if any(keyword in text for keyword in self.HIGH_RISK_KEYWORDS):
            return None

        if any(keyword in text for keyword in ("记住", "以后", "偏好", "不喜欢", "喜欢", "膝盖", "设备", "时间")) and any(
            keyword in text for keyword in ("记住", "以后", "偏好", "不喜欢", "喜欢")
        ):
            return "memory"

        if any(keyword in text for keyword in ("体重", "体脂", "腰围", "weight", "body fat")) and any(char.isdigit() for char in text):
            return "body_metric"

        if any(keyword in text for keyword in ("睡", "步", "喝水", "疲劳", "打卡")) and any(
            verb in text for verb in ("记录", "录入", "补充", "添加", "写入")
        ):
            return "daily_checkin"

        if any(keyword in text for keyword in ("训练了", "练了", "workout", "训练日志", "锻炼")) and any(
            verb in text for verb in ("记录", "录入", "添加", "写入")
        ):
            return "workout_log"

        if any(keyword in text for keyword in self.PLAN_KEYWORDS) and any(
            verb in text for verb in ("修改", "调整", "删除", "删掉", "生成", "创建", "新增", "添加", "标记", "完成", "替换")
        ):
            return "plan"

        if any(keyword in lowered for keyword in ("record weight", "log sleep", "mark complete", "delete plan")):
            return "plan" if "plan" in lowered else "daily_checkin"

        return None

    async def _render_with_llm(
        self,
        mode: str,
        user_text: str,
        context: dict[str, Any],
        fallback_content: str,
        fallback_reasoning: str,
        fallback_next_actions: list[str],
        fallback_card_title: str,
        fallback_card_description: str,
        fallback_card_bullets: list[str],
    ) -> dict[str, Any]:
        if not self.llm.is_enabled():
            return {
                "content": fallback_content,
                "reasoning_summary": fallback_reasoning,
                "next_actions": fallback_next_actions,
                "card_title": fallback_card_title,
                "card_description": fallback_card_description,
                "card_bullets": fallback_card_bullets,
            }

        system_prompt = (
            "You are Health Agent, a non-medical fitness coach. "
            f"Reply in {self._detect_reply_language(user_text)}. "
            "Return JSON only with keys: content, reasoning_summary, next_actions, card_title, card_description, card_bullets. "
            "Keep the reply concise, safe, and grounded in the provided context."
        )
        user_prompt = json.dumps(
            {
                "mode": mode,
                "user_text": user_text,
                "context": context,
                "fallback": {
                    "content": fallback_content,
                    "reasoning_summary": fallback_reasoning,
                    "next_actions": fallback_next_actions,
                    "card_title": fallback_card_title,
                    "card_description": fallback_card_description,
                    "card_bullets": fallback_card_bullets,
                },
            },
            ensure_ascii=False,
        )

        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(self.llm.generate_structured, system_prompt, user_prompt),
                timeout=settings.llm_timeout + 5,
            )
            return {
                "content": str(result.get("content") or fallback_content),
                "reasoning_summary": str(result.get("reasoning_summary") or fallback_reasoning),
                "next_actions": self._coerce_text_list(result.get("next_actions"), fallback_next_actions),
                "card_title": str(result.get("card_title") or fallback_card_title),
                "card_description": str(result.get("card_description") or fallback_card_description),
                "card_bullets": self._coerce_text_list(result.get("card_bullets"), fallback_card_bullets),
            }
        except Exception as exc:
            self.trace.log(mode=mode, llm_error=str(exc), llm_used=False)
            logger.warning("LLM rendering failed in mode=%s: %s", mode, exc)
            return {
                "content": fallback_content,
                "reasoning_summary": fallback_reasoning,
                "next_actions": fallback_next_actions,
                "card_title": fallback_card_title,
                "card_description": fallback_card_description,
                "card_bullets": fallback_card_bullets,
            }

    def _build_run(
        self,
        thread_id: str,
        risk_level: str,
        tool_events: list[ToolEvent],
        cards: list[Card],
        content: str,
        reasoning_summary: str,
    ) -> RunRecord:
        steps = [
            RunStep(
                id=str(uuid.uuid4()),
                step_type="thinking_summary",
                title="推理摘要",
                payload={"reasoning_summary": reasoning_summary},
            )
        ]
        for event in tool_events:
            steps.append(
                RunStep(
                    id=str(uuid.uuid4()),
                    step_type=event.event,
                    title=event.summary,
                    payload={"tool_name": event.tool_name, "payload": event.payload},
                )
            )
        for card in cards:
            steps.append(
                RunStep(
                    id=str(uuid.uuid4()),
                    step_type="card_render",
                    title=card.title,
                    payload=card.model_dump(mode="json"),
                )
            )
        steps.append(
            RunStep(
                id=str(uuid.uuid4()),
                step_type="final_message",
                title="最终回复",
                payload={"content": content},
            )
        )
        return RunRecord(id=str(uuid.uuid4()), thread_id=thread_id, risk_level=risk_level, steps=steps)

    async def _append_assistant_message(
        self,
        thread_id: str,
        content: str,
        reasoning_summary: str,
        cards: list[Card],
        authorization: str | None,
    ) -> MessageRecord:
        assistant_message = MessageRecord(
            id=str(uuid.uuid4()),
            role="assistant",
            content=content,
            reasoning_summary=reasoning_summary,
            cards=cards,
        )
        return await self.store.append_message(thread_id, assistant_message, authorization)

    def _build_proposal_card(self, proposal: dict[str, Any]) -> Card:
        preview = proposal.get("preview")
        preview_dict = preview if isinstance(preview, dict) else {}
        bullets = self._preview_to_bullets(preview_dict) or [proposal.get("summary", "已生成待确认提案。")]
        return Card(
            type="action_proposal_card",
            title=proposal.get("title", "待确认操作"),
            description=proposal.get("summary", ""),
            bullets=bullets,
            data={
                "proposalId": proposal.get("id"),
                "actionType": proposal.get("action_type"),
                "entityType": proposal.get("entity_type"),
                "entityId": proposal.get("entity_id"),
                "riskLevel": proposal.get("risk_level"),
                "status": proposal.get("status"),
                "preview": preview_dict,
                "requiresConfirmation": proposal.get("requires_confirmation", True),
            },
        )

    def _build_result_card(
        self,
        proposal_id: str,
        title: str,
        description: str,
        result_payload: Any,
        status: str,
    ) -> Card:
        result_dict = result_payload if isinstance(result_payload, dict) else {"result": result_payload}
        bullets = self._preview_to_bullets(result_dict) or [description]
        return Card(
            type="action_result_card",
            title=title,
            description=description,
            bullets=bullets,
            data={"proposalId": proposal_id, "status": status, "result": result_dict},
        )

    def _build_weekly_review_card(self, review: dict[str, Any]) -> Card:
        result_snapshot = review.get("result_snapshot")
        result = result_snapshot if isinstance(result_snapshot, dict) else {}
        bullets = []
        if isinstance(result.get("focus_areas"), list):
            bullets.extend(str(item) for item in result["focus_areas"][:2])
        if isinstance(result.get("risk_flags"), list):
            bullets.extend(f"风险信号: {item}" for item in result["risk_flags"][:2])
        if not bullets:
            bullets = [review.get("summary", "已生成本周复盘摘要。")]

        return Card(
            type="weekly_review_card",
            title=review.get("title", "本周复盘"),
            description=review.get("summary", "已根据近期数据生成复盘结果。"),
            bullets=bullets[:4],
            data={
                "reviewId": review.get("id"),
                "reviewType": review.get("type"),
                "status": review.get("status"),
                "adherenceScore": review.get("adherence_score"),
            },
        )

    def _build_daily_guidance_card(self, review: dict[str, Any]) -> Card:
        result_snapshot = review.get("result_snapshot")
        result = result_snapshot if isinstance(result_snapshot, dict) else {}
        guidance = result.get("guidance")
        bullets = [str(item) for item in guidance[:4]] if isinstance(guidance, list) else []
        if not bullets:
            bullets = [review.get("summary", "已生成今日恢复与训练建议。")]

        return Card(
            type="daily_guidance_card",
            title=review.get("title", "今日建议"),
            description=review.get("summary", "已结合近期状态生成今日建议。"),
            bullets=bullets,
            data={
                "reviewId": review.get("id"),
                "reviewType": review.get("type"),
                "status": review.get("status"),
            },
        )

    def _build_proposal_group_card(self, proposal_group: dict[str, Any]) -> Card:
        preview = proposal_group.get("preview")
        preview_dict = preview if isinstance(preview, dict) else {}
        bullets = self._preview_to_bullets(preview_dict) or [proposal_group.get("summary", "已生成待确认教练包。")]
        return Card(
            type="coaching_package_card",
            title=proposal_group.get("title", "待确认教练包"),
            description=proposal_group.get("summary", ""),
            bullets=bullets,
            data={
                "proposalGroupId": proposal_group.get("id"),
                "status": proposal_group.get("status"),
                "riskLevel": proposal_group.get("risk_level"),
                "reviewSnapshotId": proposal_group.get("review_snapshot_id"),
                "preview": preview_dict,
            },
        )

    async def _load_write_context(
        self,
        domain: str,
        authorization: str | None,
    ) -> tuple[dict[str, Any], list[ToolEvent]]:
        context: dict[str, Any] = {}
        tool_events: list[ToolEvent] = []

        if domain == "plan":
            tool_events.append(
                ToolEvent(event="tool_call_started", tool_name="load_current_plan", summary="读取当前训练计划")
            )
            plan = await self.tools.load_current_plan(authorization)
            tool_events.append(
                ToolEvent(
                    event="tool_call_completed",
                    tool_name="load_current_plan",
                    summary=plan.human_readable,
                    payload=self._tool_payload(plan),
                )
            )
            if plan.ok:
                context["current_plan"] = plan.data
        elif domain == "memory":
            tool_events.append(
                ToolEvent(event="tool_call_started", tool_name="get_memory_summary", summary="读取教练记忆")
            )
            memory = await self.tools.get_memory_summary(authorization)
            tool_events.append(
                ToolEvent(
                    event="tool_call_completed",
                    tool_name="get_memory_summary",
                    summary=memory.human_readable,
                    payload=self._tool_payload(memory),
                )
            )
            if memory.ok:
                context["memory_summary"] = memory.data
        elif domain in {"body_metric", "daily_checkin", "workout_log"}:
            tool_events.append(
                ToolEvent(event="tool_call_started", tool_name="query_recent_health_data", summary="读取近期健康数据")
            )
            recent = await self.tools.query_recent_health_data(authorization)
            tool_events.append(
                ToolEvent(
                    event="tool_call_completed",
                    tool_name="query_recent_health_data",
                    summary=recent.human_readable,
                    payload=self._tool_payload(recent),
                )
            )
            if recent.ok:
                context["recent_health_data"] = recent.data

        return context, tool_events

    def _build_plan_snapshot_fields(
        self,
        current_plan: dict[str, Any] | None,
        expected_day: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        snapshot: dict[str, Any] = {}
        plan_meta = current_plan.get("plan") if isinstance(current_plan, dict) else None

        if isinstance(plan_meta, dict):
            snapshot["basePlanId"] = plan_meta.get("id")
            snapshot["basePlanVersion"] = plan_meta.get("version")
            if plan_meta.get("updatedAt"):
                snapshot["basePlanUpdatedAt"] = plan_meta.get("updatedAt")

        if isinstance(expected_day, dict):
            snapshot["expectedDayId"] = expected_day.get("id")
            if expected_day.get("updatedAt"):
                snapshot["expectedDayUpdatedAt"] = expected_day.get("updatedAt")

        return {key: value for key, value in snapshot.items() if value is not None}

    def _draft_proposal(
        self,
        *,
        action_type: str,
        entity_type: str,
        title: str,
        summary: str,
        payload: dict[str, Any],
        preview: dict[str, Any],
        entity_id: str | None = None,
        snapshot_fields: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "actionType": action_type,
            "entityType": entity_type,
            "entityId": entity_id,
            "title": title,
            "summary": summary,
            "payload": payload,
            "preview": preview,
            "riskLevel": self._risk_for_action(action_type),
            "requiresConfirmation": True,
            **(snapshot_fields or {}),
        }

    @staticmethod
    def _read_summary_value(summary: dict[str, Any], *keys: str, fallback: Any = None) -> Any:
        for key in keys:
            if key in summary:
                return summary[key]
        return fallback

    def _build_outcome_context(self, coach_summary: dict[str, Any]) -> dict[str, Any]:
        raw_outcomes = self._read_summary_value(coach_summary, "recentOutcomes", "recent_outcomes", fallback=[])
        outcomes = raw_outcomes if isinstance(raw_outcomes, list) else []
        normalized: list[dict[str, Any]] = []
        status_counts: dict[str, int] = {}

        for raw_outcome in outcomes[:5]:
            if not isinstance(raw_outcome, dict):
                continue

            status = str(raw_outcome.get("status") or "unknown").strip().lower()
            status_counts[status] = status_counts.get(status, 0) + 1
            score = raw_outcome.get("score")
            summary = str(raw_outcome.get("summary") or "").strip()
            observed = raw_outcome.get("observed") if isinstance(raw_outcome.get("observed"), dict) else {}
            normalized.append(
                {
                    "id": raw_outcome.get("id"),
                    "status": status,
                    "score": score if isinstance(score, (int, float)) and not isinstance(score, bool) else None,
                    "summary": summary[:180],
                    "measurementStart": raw_outcome.get("measurementStart") or raw_outcome.get("measurement_start"),
                    "measurementEnd": raw_outcome.get("measurementEnd") or raw_outcome.get("measurement_end"),
                    "observed": observed,
                }
            )

        bullets: list[str] = []
        constraints: list[str] = []
        risk_flags: list[str] = []
        recommendation_tags: list[str] = []

        if not normalized:
            return {
                "available": False,
                "bullets": [],
                "constraints": [],
                "risk_flags": [],
                "recommendation_tags": [],
                "snapshot": {"statusCounts": {}, "items": []},
            }

        for item in normalized[:3]:
            score_text = f", score {item['score']}" if item.get("score") is not None else ""
            summary_text = f": {item['summary']}" if item.get("summary") else ""
            bullets.append(f"Outcome {item['status']}{score_text}{summary_text}")

        if status_counts.get("positive", 0) > 0:
            constraints.append("Reuse patterns from recent positive outcomes; keep the next package similarly actionable.")
            recommendation_tags.append("outcome_positive")
        if status_counts.get("mixed", 0) > 0:
            constraints.append("Treat mixed outcomes as a signal to reduce complexity and add clearer recovery checks.")
            risk_flags.append("recent_mixed_outcome")
            recommendation_tags.append("outcome_mixed")
        if status_counts.get("negative", 0) > 0:
            constraints.append("Avoid increasing intensity until the reason behind the negative outcome is understood.")
            risk_flags.append("recent_negative_outcome")
            recommendation_tags.append("outcome_negative")
        if status_counts.get("inconclusive", 0) > 0:
            constraints.append("Follow-up data was insufficient for at least one outcome; request clearer logs before strong conclusions.")
            risk_flags.append("outcome_data_insufficient")
            recommendation_tags.append("outcome_inconclusive")
        if status_counts.get("pending", 0) > 0:
            constraints.append("There are pending outcomes still measuring; avoid over-interpreting the latest package.")
            recommendation_tags.append("outcome_pending")

        return {
            "available": True,
            "bullets": bullets,
            "constraints": constraints[:4],
            "risk_flags": risk_flags,
            "recommendation_tags": recommendation_tags,
            "snapshot": {
                "statusCounts": status_counts,
                "items": normalized,
            },
        }

    def _build_phase2_plan_days(self, summary: dict[str, Any], recovery_mode: bool) -> list[dict[str, Any]]:
        current_plan = self._read_summary_value(summary, "currentPlan", "current_plan", fallback={})
        current_days = current_plan.get("days") if isinstance(current_plan, dict) else []
        base_days = current_days if isinstance(current_days, list) and current_days else [
            {
                "dayLabel": "周一",
                "focus": "上肢力量与核心",
                "duration": "50 分钟",
                "exercises": ["卧推 4x8", "高位下拉 4x10", "平板支撑 3 轮"],
                "recoveryTip": "训练后补水并做上肢拉伸。",
            },
            {
                "dayLabel": "周三",
                "focus": "下肢稳定与臀腿",
                "duration": "45 分钟",
                "exercises": ["杯式深蹲 4x10", "罗马尼亚硬拉 4x8", "臀桥 3x12"],
                "recoveryTip": "如果膝盖敏感，控制动作幅度并保留余力。",
            },
            {
                "dayLabel": "周五",
                "focus": "低强度有氧与活动恢复",
                "duration": "40 分钟",
                "exercises": ["坡度走 30 分钟", "死虫 3x12", "侧桥 3x30 秒"],
                "recoveryTip": "优先把恢复做完整，再考虑增加训练量。",
            },
        ]

        generated_days: list[dict[str, Any]] = []
        for index, day in enumerate(base_days[:4]):
            item = day if isinstance(day, dict) else {}
            focus = str(item.get("focus") or f"训练日 {index + 1}")
            recovery_tip = str(item.get("recoveryTip") or "优先保证恢复质量。")
            exercises = item.get("exercises")
            generated_days.append(
                {
                    "dayLabel": str(item.get("dayLabel") or f"训练日 {index + 1}"),
                    "focus": f"{focus}{'（恢复优先版）' if recovery_mode and index < 2 else ''}",
                    "duration": str(item.get("duration") or ("35 分钟" if recovery_mode else "45 分钟")),
                    "exercises": [str(exercise) for exercise in exercises[:4]] if isinstance(exercises, list) else [],
                    "recoveryTip": f"{recovery_tip}{' 当周把主观疲劳控制在中低水平。' if recovery_mode else ''}",
                    "sortOrder": index,
                }
            )

        return generated_days

    def _draft_coaching_package(
        self,
        flow_type: str,
        user_text: str,
        coach_summary: dict[str, Any],
    ) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], str, str, list[str]]:
        completion = self._read_summary_value(coach_summary, "completion", fallback={})
        completed_days = int(completion.get("completedDays") or completion.get("completed_days") or 0)
        total_days = int(completion.get("totalDays") or completion.get("total_days") or 0)
        completion_rate = int(completion.get("completionRate") or completion.get("completion_rate") or 0)
        checkins = self._read_summary_value(coach_summary, "recentDailyCheckins", "recent_daily_checkins", fallback=[])
        workout_logs = self._read_summary_value(coach_summary, "recentWorkoutLogs", "recent_workout_logs", fallback=[])
        body_metrics = self._read_summary_value(coach_summary, "recentBodyMetrics", "recent_body_metrics", fallback=[])
        latest_checkin = checkins[0] if isinstance(checkins, list) and checkins else {}
        sleep_hours = float(latest_checkin.get("sleepHours") or latest_checkin.get("sleep_hours") or 0)
        fatigue_level = str(latest_checkin.get("fatigueLevel") or latest_checkin.get("fatigue_level") or "moderate")
        recovery_mode = sleep_hours and sleep_hours < 7 or fatigue_level == "high"
        data_insufficient = (
            flow_type == "weekly_review"
            and total_days == 0
            and not (isinstance(checkins, list) and checkins)
            and not (isinstance(workout_logs, list) and workout_logs)
            and not (isinstance(body_metrics, list) and body_metrics)
        )
        focus_areas = [
            "先稳住恢复与睡眠，再决定是否加量。" if recovery_mode else "维持训练节奏，同时把完成度拉回稳定区间。",
            f"当前 active plan 完成度约 {completion_rate}%，下周安排应更注重可执行性。",
        ]
        risk_flags = ["最近恢复不足"] if recovery_mode else []
        recommendation_tags = ["weekly_review", "training", "diet"] if flow_type == "weekly_review" else ["daily_guidance", "recovery"]
        outcome_context = self._build_outcome_context(coach_summary)
        outcome_constraints = outcome_context["constraints"] if outcome_context.get("available") else []
        outcome_bullets = outcome_context["bullets"] if outcome_context.get("available") else []
        if outcome_constraints:
            focus_areas.append(str(outcome_constraints[0]))
        risk_flags.extend(str(flag) for flag in outcome_context.get("risk_flags", []))
        recommendation_tags.extend(str(tag) for tag in outcome_context.get("recommendation_tags", []))
        risk_flags = self._dedupe_text_items(risk_flags)
        recommendation_tags = self._dedupe_text_items(recommendation_tags)

        current_plan = self._read_summary_value(coach_summary, "currentPlan", "current_plan", fallback={})
        snapshot_fields = self._build_plan_snapshot_fields(current_plan if isinstance(current_plan, dict) else {})
        next_week_days = self._build_phase2_plan_days(coach_summary, recovery_mode)
        next_week_date = (datetime.utcnow() + timedelta(days=7)).date().isoformat()

        if flow_type == "weekly_review":
            review_title = "本周复盘数据不足" if data_insufficient else "本周复盘与下周教练包"
            review_summary = (
                "近期计划、训练日志、打卡和身体指标还不足，先生成缺失信息提示与最小行动建议。"
                if data_insufficient
                else f"基于最近一周的数据，我整理了完成度 {completion_rate}% 的复盘结果，并打包了下周计划、饮食与行为建议。"
            )
            assistant_message = (
                "最近可用于周复盘的数据还不够。我没有生成伪完整的下周计划，只整理了一条最小建议供你确认保存。"
                if data_insufficient
                else "我已经基于最近一周的训练、打卡和恢复数据生成了一份闭环教练包。确认后，我会一次性更新下周计划、饮食快照和行为建议。"
            )
            reasoning_summary = (
                "phase2 的周复盘要求数据不足时降级为最小建议，而不是伪造完整训练和饮食方案。"
                if data_insufficient
                else "这次请求属于周期性复盘，因此我先聚合近期数据，再生成可一次确认执行的 coaching package。"
            )
            next_actions = (
                ["先补充至少一次训练日志或每日打卡。", "确认保存这条最小建议。", "数据更完整后再生成下周计划。"]
                if data_insufficient
                else ["先检查复盘摘要。", "确认整包执行或直接拒绝。", "执行后到 dashboard 和计划页查看更新结果。"]
            )
            review_result = {
                "focus_areas": focus_areas,
                "risk_flags": risk_flags,
                "completion_rate": completion_rate,
                "generated_plan_days": 0 if data_insufficient else len(next_week_days),
                "data_insufficient": data_insufficient,
                "recent_outcomes": outcome_context.get("snapshot"),
                "outcome_constraints": outcome_constraints,
                "outcome_evidence": outcome_bullets,
            }
            proposals = [
                self._draft_proposal(
                    action_type="generate_next_week_plan",
                    entity_type="workout_plan",
                    title=self._proposal_title("generate_next_week_plan"),
                    summary="生成一版更可执行的下周训练计划。",
                    payload={
                        "title": "下周教练计划",
                        "goal": "consistency_and_recovery",
                        "weekOf": next_week_date,
                        "days": next_week_days,
                    },
                    preview={
                        "计划周起始": next_week_date,
                        "训练日数量": len(next_week_days),
                        "恢复策略": "恢复优先" if recovery_mode else "保持节奏",
                    },
                    snapshot_fields=snapshot_fields,
                ),
                self._draft_proposal(
                    action_type="generate_diet_snapshot",
                    entity_type="diet_snapshot",
                    title=self._proposal_title("generate_diet_snapshot"),
                    summary="生成与下周节奏匹配的饮食快照。",
                    payload={
                        "date": next_week_date,
                        "userGoal": "recovery_support",
                        "totalCalorie": 2050 if recovery_mode else 2200,
                        "targetCalorie": 2050 if recovery_mode else 2200,
                        "nutritionRatio": {"carbohydrate": 45, "protein": 30, "fat": 25},
                        "nutritionDetail": {
                            "protein": {"target": 150, "recommend": 150, "remaining": 0},
                            "carbohydrate": {"target": 220, "recommend": 220, "remaining": 0},
                            "fat": {"target": 60, "recommend": 60, "remaining": 0},
                            "fiber": {"target": 28, "recommend": 28, "remaining": 0},
                        },
                        "meals": [
                            {"mealType": "breakfast", "totalCalorie": 500, "foods": []},
                            {"mealType": "lunch", "totalCalorie": 800, "foods": []},
                            {"mealType": "dinner", "totalCalorie": 700, "foods": []},
                        ],
                        "agentTips": [
                            "优先保证蛋白质和蔬菜摄入。",
                            "训练日前后补足水和碳水。",
                            "恢复不足时避免极端热量赤字。",
                        ],
                    },
                    preview={
                        "热量目标": 2050 if recovery_mode else 2200,
                        "蛋白策略": "蛋白优先",
                        "补给重点": "训练日前后补水与碳水",
                    },
                ),
                self._draft_proposal(
                    action_type="create_advice_snapshot",
                    entity_type="advice_snapshot",
                    title=self._proposal_title("create_advice_snapshot"),
                    summary="保存一条下周行为建议，便于 dashboard 和聊天继续追踪。",
                    payload={
                        "type": "weekly_review",
                        "priority": "high" if recovery_mode else "medium",
                        "summary": focus_areas[0],
                        "reasoningTags": recommendation_tags,
                        "actionItems": [
                            "本周优先守住睡眠和补水。",
                            "训练以完成度优先，不追求额外加量。",
                            "周中复查疲劳感，再决定是否上调强度。",
                        ],
                        "riskFlags": risk_flags,
                    },
                    preview={
                        "建议主题": "恢复与执行优先",
                        "动作条数": 3,
                        "风险标记": " / ".join(risk_flags) if risk_flags else "无明显高风险",
                    },
                ),
            ]
            group_preview = {
                "复盘完成率": f"{completion_rate}%",
                "下周计划": f"{len(next_week_days)} 个训练日",
                "饮食快照": "已准备下周饮食策略",
                "行为建议": "已整理 3 条执行建议",
            }
            if data_insufficient:
                proposals = [
                    self._draft_proposal(
                        action_type="create_advice_snapshot",
                        entity_type="advice_snapshot",
                        title=self._proposal_title("create_advice_snapshot"),
                        summary="保存一条数据不足时的最小行动建议。",
                        payload={
                            "type": "weekly_review",
                            "priority": "medium",
                            "summary": "本周复盘数据不足，先补齐训练日志、每日打卡和至少一次身体指标记录。",
                            "reasoningTags": ["weekly_review", "data_gap"],
                            "actionItems": [
                                "今天补一条训练日志或恢复打卡。",
                                "下一次训练后记录完成度和疲劳反馈。",
                                "至少补一次体重或围度记录，再生成完整周复盘。",
                            ],
                            "riskFlags": ["复盘数据不足"],
                        },
                        preview={
                            "建议类型": "缺失信息提示",
                            "不会写入": "下周训练计划 / 饮食快照",
                            "下一步": "补齐日志后重新复盘",
                        },
                    )
                ]
                group_preview = {
                    "数据状态": "不足以生成完整周复盘",
                    "本次写入": "仅保存最小建议",
                    "待补充": "训练日志 / 每日打卡 / 身体指标",
                }
        else:
            review_title = "今日恢复与训练建议"
            review_summary = "我已经结合最近的睡眠、疲劳和当前训练进度，整理出一份轻量的今日建议包。"
            assistant_message = "我已经根据你当前的恢复状态整理出一份轻量教练包。确认后，我会把今日建议写入系统，方便后续 dashboard 和聊天继续衔接。"
            reasoning_summary = "这次请求更适合走 daily guidance flow，所以我生成的是轻量建议而不是直接重排整周计划。"
            next_actions = ["先看今日建议。", "如果合适就确认保存。", "需要的话我也可以继续升级成整周复盘。"]
            review_result = {
                "guidance": [
                    "今天先把强度压到中低水平。" if recovery_mode else "今天可以按原计划训练，但不要额外加量。",
                    "训练后安排 8-10 分钟整理活动与拉伸。",
                    "晚间优先补水并尽量保证 7 小时以上睡眠。",
                ],
                "risk_flags": risk_flags,
                "recent_outcomes": outcome_context.get("snapshot"),
                "outcome_constraints": outcome_constraints,
                "outcome_evidence": outcome_bullets,
            }
            proposals = [
                self._draft_proposal(
                    action_type="create_advice_snapshot",
                    entity_type="advice_snapshot",
                    title=self._proposal_title("create_advice_snapshot"),
                    summary="保存一条今日建议，便于稍后继续复盘和追踪。",
                    payload={
                        "type": "daily_guidance",
                        "priority": "high" if recovery_mode else "medium",
                        "summary": review_result["guidance"][0],
                        "reasoningTags": recommendation_tags,
                        "actionItems": review_result["guidance"],
                        "riskFlags": risk_flags,
                    },
                    preview={
                        "今日重点": "恢复优先" if recovery_mode else "按计划但不过量",
                        "建议条数": len(review_result["guidance"]),
                        "状态依据": f"睡眠 {sleep_hours or '未知'} 小时 / 疲劳 {fatigue_level}",
                    },
                )
            ]
            group_preview = {
                "建议类型": "daily guidance",
                "今日重点": "恢复优先" if recovery_mode else "保持节奏",
                "依据": f"完成 {completed_days}/{total_days} 个训练日",
            }

        if outcome_bullets:
            group_preview["Recent outcome evidence"] = outcome_bullets[:2]
        if outcome_constraints:
            group_preview["Outcome constraint"] = outcome_constraints[0]
            reasoning_summary = f"{reasoning_summary} Recent outcome evidence was applied as a constraint: {outcome_constraints[0]}"

        review_payload = {
            "type": flow_type,
            "title": review_title,
            "summary": review_summary,
            "status": "draft",
            "adherenceScore": completion_rate,
            "riskFlags": risk_flags,
            "focusAreas": focus_areas,
            "recommendationTags": recommendation_tags,
            "inputSnapshot": coach_summary,
            "resultSnapshot": review_result,
        }
        group_payload = {
            "title": "本周 coaching package" if flow_type == "weekly_review" else "今日 coaching package",
            "summary": "一次确认即可应用本次复盘生成的整包建议。"
            if flow_type == "weekly_review"
            else "一次确认即可保存今日建议，便于后续继续追踪。",
            "preview": group_preview,
            "riskLevel": self._max_risk_level([proposal["riskLevel"] for proposal in proposals]),
        }
        return review_payload, group_payload, proposals, assistant_message, reasoning_summary, next_actions

    def _heuristic_write_proposals(
        self,
        domain: str,
        user_text: str,
        context: dict[str, Any],
    ) -> list[dict[str, Any]]:
        if domain == "body_metric":
            return self._body_metric_proposals(user_text)
        if domain == "daily_checkin":
            return self._daily_checkin_proposals(user_text)
        if domain == "workout_log":
            return self._workout_log_proposals(user_text)
        if domain == "plan":
            return self._plan_proposals(user_text, context)
        if domain == "memory":
            return self._memory_proposals(user_text, context)
        return []

    def _memory_type_from_text(self, user_text: str) -> str:
        if any(keyword in user_text for keyword in ("膝盖", "疼", "不舒服", "受伤", "恢复", "疲劳")):
            return "recovery_pattern"
        if any(keyword in user_text for keyword in ("器械", "设备", "哑铃", "杠铃", "健身房", "家里")):
            return "equipment_constraint"
        if any(keyword in user_text for keyword in ("早上", "晚上", "中午", "时间", "周末")):
            return "schedule_preference"
        if any(keyword in user_text for keyword in ("吃", "饮食", "乳糖", "过敏", "素食")):
            return "diet_preference"
        if any(keyword in user_text for keyword in ("喜欢", "不喜欢", "跑步", "力量", "有氧")):
            return "training_preference"
        return "behavior_pattern"

    def _memory_proposals(self, user_text: str, context: dict[str, Any]) -> list[dict[str, Any]]:
        memory_summary = context.get("memory_summary")
        active_memories = memory_summary.get("activeMemories") if isinstance(memory_summary, dict) else []
        normalized_text = re.sub(r"\s+", " ", user_text).strip()
        cleaned = re.sub(r"^(请)?(帮我)?记住[:,，：]?", "", normalized_text).strip()
        summary = cleaned[:120] if cleaned else normalized_text[:120]
        memory_type = self._memory_type_from_text(user_text)

        if not summary:
            return []

        preview: dict[str, Any] = {
            "记忆类型": memory_type,
            "记忆摘要": summary,
            "置信度": 72,
        }
        if isinstance(active_memories, list) and active_memories:
            preview["已有记忆数量"] = len(active_memories)

        return [
            self._draft_proposal(
                action_type="create_coaching_memory",
                entity_type="coaching_memory",
                title=self._proposal_title("create_coaching_memory"),
                summary=f"保存一条长期教练记忆：{summary}",
                payload={
                    "memoryType": memory_type,
                    "title": "用户偏好与约束",
                    "summary": summary,
                    "value": {
                        "rawText": normalized_text,
                        "extractedSummary": summary,
                    },
                    "confidence": 72,
                    "sourceType": "chat",
                    "reason": "用户在聊天中明确要求记住长期偏好或约束。",
                },
                preview=preview,
            )
        ]

    def _body_metric_proposals(self, user_text: str) -> list[dict[str, Any]]:
        weight = self._extract_number(
            [r"体重[^\d]*(\d+(?:\.\d+)?)", r"(\d+(?:\.\d+)?)\s*(?:kg|公斤)", r"weight[^\d]*(\d+(?:\.\d+)?)"],
            user_text,
        )
        body_fat = self._extract_number([r"体脂[^\d]*(\d+(?:\.\d+)?)", r"body fat[^\d]*(\d+(?:\.\d+)?)"], user_text)
        waist = self._extract_number([r"腰围[^\d]*(\d+(?:\.\d+)?)", r"waist[^\d]*(\d+(?:\.\d+)?)"], user_text)

        if weight is None:
            return []

        payload = {"weightKg": weight}
        preview: dict[str, Any] = {"体重(kg)": weight}
        if body_fat is not None:
            payload["bodyFatPct"] = body_fat
            preview["体脂(%)"] = body_fat
        if waist is not None:
            payload["waistCm"] = waist
            preview["腰围(cm)"] = waist

        return [
            self._draft_proposal(
                action_type="create_body_metric",
                entity_type="body_metric",
                title=self._proposal_title("create_body_metric"),
                summary=f"记录最新身体指标，体重 {weight} kg。",
                payload=payload,
                preview=preview,
            )
        ]

    def _daily_checkin_proposals(self, user_text: str) -> list[dict[str, Any]]:
        sleep = self._extract_number([r"睡[^\d]*(\d+(?:\.\d+)?)\s*(?:小时|h|hour)", r"sleep[^\d]*(\d+(?:\.\d+)?)"], user_text)
        steps = self._extract_number([r"(\d+)\s*步", r"(\d+)\s*steps?"], user_text)
        water = self._extract_number([r"喝水[^\d]*(\d+)", r"(\d+)\s*ml", r"water[^\d]*(\d+)"], user_text)

        payload: dict[str, Any] = {}
        preview: dict[str, Any] = {}

        if sleep is not None:
            payload["sleepHours"] = sleep
            preview["睡眠(小时)"] = sleep
        if steps is not None:
            payload["steps"] = int(steps)
            preview["步数"] = int(steps)
        if water is not None:
            payload["waterMl"] = int(water)
            preview["饮水(ml)"] = int(water)
        if "很累" in user_text or "疲劳" in user_text:
            payload["fatigueLevel"] = "high"
            preview["疲劳等级"] = "high"

        if not payload:
            return []

        return [
            self._draft_proposal(
                action_type="create_daily_checkin",
                entity_type="daily_checkin",
                title=self._proposal_title("create_daily_checkin"),
                summary="记录今天的每日打卡数据。",
                payload=payload,
                preview=preview,
            )
        ]

    def _workout_log_proposals(self, user_text: str) -> list[dict[str, Any]]:
        duration = self._extract_number([r"(\d+)\s*分钟", r"(\d+)\s*min"], user_text)
        if duration is None and "训练" not in user_text and "workout" not in user_text.lower():
            return []

        workout_type = "strength" if any(token in user_text.lower() for token in ("力量", "strength")) else "general_workout"
        intensity = "high" if any(token in user_text for token in ("高强度", "很猛")) else "moderate"
        note = self._normalize_focus_from_text(user_text, "已记录训练完成情况")

        return [
            self._draft_proposal(
                action_type="create_workout_log",
                entity_type="workout_log",
                title=self._proposal_title("create_workout_log"),
                summary="记录一次训练日志。",
                payload={
                    "workoutType": workout_type,
                    "durationMin": int(duration or 45),
                    "intensity": intensity,
                    "exerciseNote": note,
                },
                preview={
                    "训练类型": workout_type,
                    "时长(分钟)": int(duration or 45),
                    "强度": intensity,
                    "备注": note,
                },
            )
        ]

    def _plan_proposals(self, user_text: str, context: dict[str, Any]) -> list[dict[str, Any]]:
        current_plan = context.get("current_plan")
        days = current_plan.get("days", []) if isinstance(current_plan, dict) else []
        matched_day = self._extract_day_label(user_text, days if isinstance(days, list) else [])
        lowered = user_text.lower()

        if not isinstance(current_plan, dict) or not current_plan.get("plan"):
            if any(keyword in user_text for keyword in ("生成", "创建", "安排", "下周")) or "plan" in lowered:
                goal = "fat_loss"
                if "增肌" in user_text or "muscle" in lowered:
                    goal = "muscle_gain"
                if "维持" in user_text or "maintenance" in lowered:
                    goal = "maintenance"
                return [
                    self._draft_proposal(
                        action_type="generate_plan",
                        entity_type="workout_plan",
                        title=self._proposal_title("generate_plan"),
                        summary="生成一份新的训练计划。",
                        payload={"goal": goal},
                        preview={"目标": goal},
                    )
                ]
            return []

        snapshot_fields = self._build_plan_snapshot_fields(current_plan, matched_day)

        if any(keyword in user_text for keyword in ("删除", "删掉", "移除")) and matched_day:
            return [
                self._draft_proposal(
                    action_type="delete_plan_day",
                    entity_type="workout_plan_day",
                    entity_id=str(matched_day.get("id")),
                    title=self._proposal_title("delete_plan_day"),
                    summary=f"删除计划项“{matched_day.get('dayLabel')} - {matched_day.get('focus')}”。",
                    payload={"dayId": matched_day.get("id")},
                    preview={"日期": matched_day.get("dayLabel"), "计划项": matched_day.get("focus")},
                    snapshot_fields=snapshot_fields,
                )
            ]

        if any(keyword in user_text for keyword in ("完成", "勾选", "打勾", "done")) and matched_day:
            is_completed = not any(keyword in user_text for keyword in ("取消", "撤销", "undo"))
            return [
                self._draft_proposal(
                    action_type="complete_plan_day",
                    entity_type="workout_plan_day",
                    entity_id=str(matched_day.get("id")),
                    title=self._proposal_title("complete_plan_day"),
                    summary=f"{'标记完成' if is_completed else '取消完成'}“{matched_day.get('dayLabel')} - {matched_day.get('focus')}”。",
                    payload={"dayId": matched_day.get("id"), "isCompleted": is_completed},
                    preview={
                        "日期": matched_day.get("dayLabel"),
                        "计划项": matched_day.get("focus"),
                        "完成状态": "完成" if is_completed else "未完成",
                    },
                    snapshot_fields=snapshot_fields,
                )
            ]

        if any(keyword in user_text for keyword in ("新增", "添加", "加一个", "新建")):
            day_label = re.search(r"(周[一二三四五六日天])", user_text)
            duration = self._extract_number([r"(\d+)\s*分钟", r"(\d+)\s*min"], user_text)
            focus = self._normalize_focus_from_text(user_text, "新增训练安排")
            exercises = [focus]
            return [
                self._draft_proposal(
                    action_type="create_plan_day",
                    entity_type="workout_plan_day",
                    title=self._proposal_title("create_plan_day"),
                    summary="新增一条当前计划的训练项。",
                    payload={
                        "dayLabel": day_label.group(1) if day_label else "待安排",
                        "focus": focus,
                        "duration": f"{int(duration)} 分钟" if duration is not None else "45 分钟",
                        "exercises": exercises,
                        "recoveryTip": "注意补水和睡眠恢复。",
                    },
                    preview={
                        "日期": day_label.group(1) if day_label else "待安排",
                        "计划项": focus,
                        "时长": f"{int(duration)} 分钟" if duration is not None else "45 分钟",
                    },
                    snapshot_fields=self._build_plan_snapshot_fields(current_plan),
                )
            ]

        if matched_day and any(keyword in user_text for keyword in ("改成", "修改", "调整", "换成", "替换")):
            next_focus_match = re.search(r"(?:改成|修改成|换成|替换成|调整成)(.+)", user_text)
            next_focus = self._normalize_focus_from_text(next_focus_match.group(1) if next_focus_match else user_text, str(matched_day.get("focus")))
            duration = self._extract_number([r"(\d+)\s*分钟", r"(\d+)\s*min"], user_text)
            return [
                self._draft_proposal(
                    action_type="update_plan_day",
                    entity_type="workout_plan_day",
                    entity_id=str(matched_day.get("id")),
                    title=self._proposal_title("update_plan_day"),
                    summary=f"更新计划项“{matched_day.get('dayLabel')} - {matched_day.get('focus')}”。",
                    payload={
                        "dayId": matched_day.get("id"),
                        "focus": next_focus,
                        "duration": f"{int(duration)} 分钟" if duration is not None else matched_day.get("duration"),
                    },
                    preview={
                        "日期": matched_day.get("dayLabel"),
                        "原计划": matched_day.get("focus"),
                        "新计划": next_focus,
                    },
                    snapshot_fields=snapshot_fields,
                )
            ]

        if any(keyword in user_text for keyword in ("重新生成", "生成计划", "下周计划")):
            goal = "fat_loss"
            if "增肌" in user_text or "muscle" in lowered:
                goal = "muscle_gain"
            if "维持" in user_text or "maintenance" in lowered:
                goal = "maintenance"
            return [
                self._draft_proposal(
                    action_type="generate_plan",
                    entity_type="workout_plan",
                    title=self._proposal_title("generate_plan"),
                    summary="生成一份新的训练计划，并替换当前 active plan。",
                    payload={"goal": goal},
                    preview={"目标": goal, "当前计划": current_plan.get("plan", {}).get("title")},
                    snapshot_fields=self._build_plan_snapshot_fields(current_plan),
                )
            ]

        if any(keyword in user_text for keyword in ("调整当前计划", "重排计划", "整体调整")):
            return [
                self._draft_proposal(
                    action_type="adjust_plan",
                    entity_type="workout_plan",
                    title=self._proposal_title("adjust_plan"),
                    summary="根据当前要求整体调整 active plan。",
                    payload={"note": user_text.strip()},
                    preview={"调整说明": user_text.strip()},
                    snapshot_fields=self._build_plan_snapshot_fields(current_plan),
                )
            ]

        return []

    def _validate_proposals(
        self,
        proposals: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], list[str]]:
        valid: list[dict[str, Any]] = []
        warnings: list[str] = []

        for proposal in proposals:
            action_type = str(proposal.get("actionType") or "")
            payload = proposal.get("payload")
            preview = proposal.get("preview")

            if action_type not in self.ACTION_TYPES:
                warnings.append(f"忽略了不在白名单内的动作类型：{action_type or 'unknown'}。")
                continue
            if not isinstance(payload, dict):
                warnings.append(f"忽略了 payload 非法的提案：{proposal.get('title', action_type)}。")
                continue
            if not isinstance(preview, dict):
                warnings.append(f"忽略了 preview 非法的提案：{proposal.get('title', action_type)}。")
                continue

            valid.append(proposal)

        return valid, warnings[:3]

    async def _handle_health(
        self,
        request: PostMessageRequest,
        authorization: str | None,
    ) -> tuple[str, str, list[Card], list[str], list[ToolEvent]]:
        tool_events = [ToolEvent(event="tool_call_started", tool_name="get_user_profile", summary="读取用户资料")]
        profile = await self.tools.get_user_profile(authorization)
        tool_events.append(
            ToolEvent(
                event="tool_call_completed",
                tool_name="get_user_profile",
                summary=profile.human_readable,
                payload=self._tool_payload(profile),
            )
        )

        tool_events.append(ToolEvent(event="tool_call_started", tool_name="query_recent_health_data", summary="读取近期健康数据"))
        recent = await self.tools.query_recent_health_data(authorization)
        tool_events.append(
            ToolEvent(
                event="tool_call_completed",
                tool_name="query_recent_health_data",
                summary=recent.human_readable,
                payload=self._tool_payload(recent),
            )
        )

        fatigue_level = "moderate"
        if recent.ok:
            latest_checkin = (recent.data.get("daily_checkins") or [None])[0]
            if isinstance(latest_checkin, dict) and latest_checkin.get("fatigueLevel"):
                fatigue_level = str(latest_checkin.get("fatigueLevel"))

        recovery = await self.tools.get_recovery_guidance(fatigue_level=fatigue_level)
        rendered = await self._render_with_llm(
            mode="health",
            user_text=request.text,
            context={"profile": profile.data if profile.ok else {}, "recent_health_data": recent.data if recent.ok else {}},
            fallback_content="我先结合你的资料、近期训练与恢复数据整理了一版建议。当前更重要的是先稳住恢复，再决定要不要追加训练量。",
            fallback_reasoning="这次回复优先参考了用户资料、近期打卡和恢复状态，而不是只基于单轮文本给建议。",
            fallback_next_actions=["如果你愿意，我可以继续帮你整理成待确认提案。", "也可以告诉我你今晚是否还要训练。", "如果想落库，我会先生成结构化提案。"],
            fallback_card_title="恢复与训练建议",
            fallback_card_description="以下建议基于当前资料和近期日志生成。",
            fallback_card_bullets=recovery.data.get("guidance", []),
        )
        cards = [
            Card(
                type="health_advice_card",
                title=rendered["card_title"],
                description=rendered["card_description"],
                bullets=rendered["card_bullets"],
            )
        ]
        return rendered["content"], rendered["reasoning_summary"], cards, rendered["next_actions"], tool_events

    async def _handle_plan(
        self,
        request: PostMessageRequest,
        authorization: str | None,
    ) -> tuple[str, str, list[Card], list[str], list[ToolEvent]]:
        tool_events = [ToolEvent(event="tool_call_started", tool_name="load_current_plan", summary="读取当前训练计划")]
        plan = await self.tools.load_current_plan(authorization)
        tool_events.append(
            ToolEvent(
                event="tool_call_completed",
                tool_name="load_current_plan",
                summary=plan.human_readable,
                payload=self._tool_payload(plan),
            )
        )

        if not plan.ok:
            cards = [
                Card(
                    type="tool_activity_card",
                    title="训练计划暂不可用",
                    description=plan.human_readable,
                    bullets=["确认 backend 正在运行。", "确认当前用户已经有 active plan。", "恢复后再试一次。"],
                )
            ]
            return (
                "我现在拿不到当前训练计划，所以不能基于真实数据继续给出计划建议。",
                "当前计划读取失败，因此这次不继续做计划推断。",
                cards,
                ["去 dashboard 检查当前计划是否存在。", "如果需要，我可以先帮你生成新计划。", "稍后重试。"],
                tool_events,
            )

        snapshot = plan.data
        days = snapshot.get("days", [])
        rendered = await self._render_with_llm(
            mode="plan",
            user_text=request.text,
            context={"current_plan": snapshot},
            fallback_content="我已经读取了当前 active plan。你可以继续让我调整某一天、补一条计划项，或者先生成待确认提案。",
            fallback_reasoning="这次回复先读取了当前 active plan，再基于真实计划给出建议。",
            fallback_next_actions=["指定你想调整的训练日。", "告诉我目标是减脂、恢复还是补练。", "也可以直接让我生成待确认提案。"],
            fallback_card_title="当前计划概览",
            fallback_card_description="这里展示的是数据库中的 active 训练计划。",
            fallback_card_bullets=[
                f"{day.get('dayLabel')}: {day.get('focus') or '未设置重点'}" for day in (days[:4] if isinstance(days, list) else [])
            ] or ["当前计划为空"],
        )
        cards = [
            Card(
                type="workout_plan_card",
                title=rendered["card_title"],
                description=rendered["card_description"],
                bullets=rendered["card_bullets"],
            )
        ]
        return rendered["content"], rendered["reasoning_summary"], cards, rendered["next_actions"], tool_events

    async def _handle_exercise(
        self,
        request: PostMessageRequest,
        authorization: str | None,
    ) -> tuple[str, str, list[Card], list[str], list[ToolEvent]]:
        del authorization
        tool_events = [ToolEvent(event="tool_call_started", tool_name="get_exercise_catalog", summary="读取动作库")]
        exercises = await self.tools.get_exercise_catalog()
        tool_events.append(
            ToolEvent(
                event="tool_call_completed",
                tool_name="get_exercise_catalog",
                summary=exercises.human_readable,
                payload=self._tool_payload(exercises),
            )
        )

        if not exercises.ok:
            cards = [
                Card(
                    type="tool_activity_card",
                    title="动作库暂不可用",
                    description=exercises.human_readable,
                    bullets=["确认 exercises 接口可用。", "稍后重试。", "也可以先告诉我你想替代哪个动作。"],
                )
            ]
            return (
                "我现在拿不到动作库，所以这次不基于数据库继续推荐动作替代。",
                "动作库读取失败，因此不继续生成动作建议。",
                cards,
                ["告诉我你想替代的动作。", "去 exercises 页面确认数据是否可用。", "稍后再试。"],
                tool_events,
            )

        items = exercises.data.get("items", [])
        rendered = await self._render_with_llm(
            mode="exercise",
            user_text=request.text,
            context={"exercise_catalog": items[:20]},
            fallback_content="我已经读取了动作库。你可以继续告诉我想替代哪个动作、是否有器械限制，或者让我按目标推荐几种可选动作。",
            fallback_reasoning="这次建议先检查动作库，再给出替代方向，会比直接凭空猜更稳妥。",
            fallback_next_actions=["告诉我你想替代哪个动作。", "说明是否有器械限制。", "让我按目标推荐几种可选动作。"],
            fallback_card_title="动作建议",
            fallback_card_description="这里展示的是当前动作库里最适合继续深入的问题入口。",
            fallback_card_bullets=[str(item.get("name") or "Unnamed exercise") for item in items[:5]] or ["动作库为空"],
        )
        cards = [
            Card(
                type="exercise_card",
                title=rendered["card_title"],
                description=rendered["card_description"],
                bullets=rendered["card_bullets"],
            )
        ]
        return rendered["content"], rendered["reasoning_summary"], cards, rendered["next_actions"], tool_events

    async def _handle_location(
        self,
        request: PostMessageRequest,
        authorization: str | None,
    ) -> tuple[str, str, list[Card], list[str], list[ToolEvent]]:
        del authorization
        tool_events: list[ToolEvent] = []
        latitude = request.latitude
        longitude = request.longitude

        if latitude is None or longitude is None:
            if not request.location_hint:
                cards = [
                    Card(
                        type="place_result_card",
                        title="需要地点信息",
                        description="给我一个地点名或前端定位，我就可以继续帮你查附近训练地点。",
                        bullets=["例如：上海浦东张江。", "或者直接从前端打开定位。"],
                    )
                ]
                return (
                    "如果你想让我查附近的健身房、公园或步道，请直接给我一个地点名，或者从前端把定位传过来。",
                    "位置检索需要明确地点，否则无法调用地图搜索。",
                    cards,
                    ["补充地点名。", "允许前端传定位。", "告诉我你要找的是健身房还是公园。"],
                    tool_events,
                )

            tool_events.append(ToolEvent(event="tool_call_started", tool_name="geocode_location", summary="解析地点坐标"))
            geocoded = await self.tools.geocode_location(request.location_hint)
            tool_events.append(
                ToolEvent(
                    event="tool_call_completed",
                    tool_name="geocode_location",
                    summary=geocoded.human_readable,
                    payload=self._tool_payload(geocoded),
                )
            )

            if not geocoded.ok:
                cards = [
                    Card(
                        type="tool_activity_card",
                        title="地点解析失败",
                        description=geocoded.human_readable,
                        bullets=["检查地点名称是否足够具体。", "稍后重试。", "也可以直接提供经纬度。"],
                    )
                ]
                return (
                    "我没能把这个地点解析成坐标，所以暂时不能继续查附近地点。",
                    "附近地点搜索依赖坐标，地点解析失败后这次先停在这里。",
                    cards,
                    ["换一个更具体的地点名。", "直接发送定位。", "稍后重试。"],
                    tool_events,
                )

            latitude = float(geocoded.data["latitude"])
            longitude = float(geocoded.data["longitude"])

        tool_events.append(ToolEvent(event="tool_call_started", tool_name="search_nearby_places", summary="搜索附近地点"))
        nearby = await self.tools.search_nearby_places(
            keyword="gym",
            latitude=latitude,
            longitude=longitude,
            location_hint=request.location_hint,
        )
        tool_events.append(
            ToolEvent(
                event="tool_call_completed",
                tool_name="search_nearby_places",
                summary=nearby.human_readable,
                payload=self._tool_payload(nearby),
            )
        )

        if not nearby.ok:
            cards = [
                Card(
                    type="tool_activity_card",
                    title="附近地点搜索失败",
                    description=nearby.human_readable,
                    bullets=["确认 AMap 已正确配置。", "稍后重试。", "也可以先告诉我更具体的区域。"],
                )
            ]
            return (
                "我没能完成附近地点搜索。",
                "地图搜索没有返回可用结果，所以这次不继续推荐地点。",
                cards,
                ["补充更具体的位置。", "稍后重试。", "确认地图 API 配置。"],
                tool_events,
            )

        ranked = sorted(nearby.data.get("places", []), key=compute_place_rank, reverse=True)
        top_places = ranked[:5]
        cards = [
            Card(
                type="place_result_card",
                title="附近训练地点",
                description="我按距离和可训练性做了一个简单排序。",
                bullets=[
                    f"{place.get('name')} | {place.get('distance_m')}m | {place.get('address') or '地址待确认'}"
                    for place in top_places
                ] or ["没有找到合适地点"],
            )
        ]
        return (
            "我已经帮你查了一轮附近可训练地点。如果你愿意，我还可以继续按力量训练、游泳或户外步道再细分推荐。",
            "这次先解析位置，再调用地图搜索，并按距离和训练适配度做了简单排序。",
            cards,
            ["告诉我你更偏好健身房还是户外。", "如果要找游泳馆，我可以再筛一轮。", "也可以换一个地点重新查。"],
            tool_events,
        )

    async def _process_coaching_flow(
        self,
        flow_type: str,
        thread_id: str,
        request: PostMessageRequest,
        authorization: str | None,
    ) -> PostMessageResponse:
        tool_events = [ToolEvent(event="tool_call_started", tool_name="get_coach_summary", summary="读取教练复盘上下文")]
        coach_summary = await self.tools.get_coach_summary(authorization)
        tool_events.append(
            ToolEvent(
                event="tool_call_completed",
                tool_name="get_coach_summary",
                summary=coach_summary.human_readable,
                payload=self._tool_payload(coach_summary),
            )
        )

        if not coach_summary.ok:
            content = "我暂时拿不到做复盘所需的完整上下文，所以现在不能安全生成教练包。"
            reasoning_summary = "phase2 的复盘流依赖聚合上下文；这次读取失败，所以不继续生成 package。"
            cards = [
                Card(
                    type="tool_activity_card",
                    title="复盘上下文暂不可用",
                    description=coach_summary.human_readable,
                    bullets=["确认 backend 正在运行。", "确认当前账号能正常读取计划和日志。", "恢复后再试一次。"],
                )
            ]
            run = self._build_run(
                thread_id=thread_id,
                risk_level="medium",
                tool_events=tool_events,
                cards=cards,
                content=content,
                reasoning_summary=reasoning_summary,
            )
            await self.store.save_run(run, authorization)
            message = await self._append_assistant_message(thread_id, content, reasoning_summary, cards, authorization)
            return PostMessageResponse(
                id=message.id,
                content=message.content,
                reasoning_summary=message.reasoning_summary or reasoning_summary,
                cards=cards,
                run_id=run.id,
                tool_events=tool_events,
                next_actions=["先检查 backend 和数据库状态。", "确认当前用户已有计划或日志数据。", "稍后重新触发复盘。"],
                risk_level=run.risk_level,
            )

        pending_package = self._read_summary_value(
            coach_summary.data,
            "pendingCoachingPackage",
            "pending_coaching_package",
            fallback=None,
        )
        if isinstance(pending_package, dict) and pending_package.get("id"):
            try:
                proposal_group = await self.store.get_proposal_group(str(pending_package["id"]), authorization)
            except Exception:
                proposal_group = {
                    "id": pending_package.get("id"),
                    "thread_id": pending_package.get("threadId") or thread_id,
                    "title": pending_package.get("title", "待处理教练包"),
                    "summary": pending_package.get("summary", "你已经有一份待处理教练包。"),
                    "status": pending_package.get("status", "pending"),
                    "risk_level": pending_package.get("riskLevel", "medium"),
                    "preview": {"状态": pending_package.get("status", "pending")},
                }

            content = "你已经有一份待处理的教练包。我先把现有教练包带回来，避免生成第二份互相冲突的建议。"
            reasoning_summary = "phase2 要求同一账号存在 pending package 时优先恢复现有状态，而不是重复生成新的 package。"
            cards = [self._build_proposal_group_card(proposal_group)]
            risk_level = str(proposal_group.get("risk_level") or "medium")
            if risk_level not in {"low", "medium", "high"}:
                risk_level = "medium"
            run = self._build_run(
                thread_id=thread_id,
                risk_level=risk_level,
                tool_events=tool_events,
                cards=cards,
                content=content,
                reasoning_summary=reasoning_summary,
            )
            await self.store.save_run(run, authorization)
            message = await self._append_assistant_message(thread_id, content, reasoning_summary, cards, authorization)
            return PostMessageResponse(
                id=message.id,
                content=message.content,
                reasoning_summary=message.reasoning_summary or reasoning_summary,
                cards=cards,
                run_id=run.id,
                tool_events=tool_events,
                next_actions=["先处理当前教练包。", "确认执行或拒绝。", "处理后再重新触发新的复盘。"],
                risk_level=run.risk_level,
            )

        review_payload, group_payload, proposals, assistant_message, reasoning_summary, next_actions = self._draft_coaching_package(
            flow_type,
            request.text,
            coach_summary.data,
        )

        run = self._build_run(
            thread_id=thread_id,
            risk_level=self._max_risk_level([proposal["riskLevel"] for proposal in proposals]),
            tool_events=tool_events,
            cards=[],
            content=assistant_message,
            reasoning_summary=reasoning_summary,
        )
        await self.store.save_run(run, authorization)

        created_package = await self.store.create_coaching_package(
            thread_id,
            {
                "review": {**review_payload, "runId": run.id},
                "proposalGroup": {**group_payload, "runId": run.id},
                "proposals": proposals,
            },
            authorization,
        )
        review = created_package["review"]
        proposal_group = created_package["proposal_group"]

        cards = [
            self._build_weekly_review_card(review) if flow_type == "weekly_review" else self._build_daily_guidance_card(review),
            self._build_proposal_group_card(proposal_group),
        ]
        message = await self._append_assistant_message(
            thread_id=thread_id,
            content=assistant_message,
            reasoning_summary=reasoning_summary,
            cards=cards,
            authorization=authorization,
        )
        return PostMessageResponse(
            id=message.id,
            content=message.content,
            reasoning_summary=message.reasoning_summary or reasoning_summary,
            cards=cards,
            run_id=run.id,
            tool_events=tool_events,
            next_actions=next_actions,
            risk_level=run.risk_level,
        )

    async def process_message(
        self,
        thread_id: str,
        request: PostMessageRequest,
        authorization: str | None = None,
    ) -> PostMessageResponse:
        user_message = MessageRecord(id=str(uuid.uuid4()), role="user", content=request.text)
        await self.store.append_message(thread_id, user_message, authorization)

        write_domain = self._detect_write_domain(request.text)
        self.trace.log(
            user_id=self._extract_user_id_from_authorization(authorization),
            thread_id=thread_id,
            text=request.text,
            write_domain=write_domain,
        )

        if self._is_weekly_review_request(request.text):
            return await self._process_coaching_flow("weekly_review", thread_id, request, authorization)

        if self._is_daily_guidance_request(request.text):
            return await self._process_coaching_flow("daily_guidance", thread_id, request, authorization)

        if write_domain:
            context, tool_events = await self._load_write_context(write_domain, authorization)
            proposed = self._heuristic_write_proposals(write_domain, request.text, context)
            proposals, validation_warnings = self._validate_proposals(proposed)

            if proposals:
                assistant_message = f"我先把这次请求整理成了 {len(proposals)} 条待确认提案。你确认后，我再通过后端命令写入数据库。"
                reasoning_summary = "这次请求涉及写操作，所以先生成结构化提案，再进入确认执行链路。"
                next_actions = ["检查提案内容。", "确认执行或拒绝。", "执行后刷新相关页面查看结果。"]
            else:
                assistant_message = "我理解到你想修改数据，但当前信息还不足以生成安全提案。"
                reasoning_summary = "这次请求没有得到足够明确的目标对象或字段，因此暂不进入写库。"
                next_actions = ["补充更具体的目标对象。", "说明你想新增、修改还是删除。", "如果是计划项，请告诉我对应训练日。"]

            if validation_warnings:
                next_actions = [*validation_warnings, *next_actions][:3]

            run = self._build_run(
                thread_id=thread_id,
                risk_level=self._max_risk_level([proposal["riskLevel"] for proposal in proposals]) if proposals else "medium",
                tool_events=tool_events,
                cards=[],
                content=assistant_message,
                reasoning_summary=reasoning_summary,
            )
            await self.store.save_run(run, authorization)

            created_proposals = await self.store.create_proposals(thread_id, run.id, proposals, authorization) if proposals else []
            cards = [self._build_proposal_card(proposal) for proposal in created_proposals]
            message = await self._append_assistant_message(
                thread_id=thread_id,
                content=assistant_message,
                reasoning_summary=reasoning_summary,
                cards=cards,
                authorization=authorization,
            )
            return PostMessageResponse(
                id=message.id,
                content=message.content,
                reasoning_summary=message.reasoning_summary or reasoning_summary,
                cards=cards,
                run_id=run.id,
                tool_events=tool_events,
                next_actions=next_actions,
                risk_level=run.risk_level,
            )

        if self._is_location_query(request.text):
            content, reasoning_summary, cards, next_actions, tool_events = await self._handle_location(request, authorization)
            risk_level = "low"
        elif self._is_exercise_query(request.text):
            content, reasoning_summary, cards, next_actions, tool_events = await self._handle_exercise(request, authorization)
            risk_level = "low"
        elif self._is_plan_query(request.text):
            content, reasoning_summary, cards, next_actions, tool_events = await self._handle_plan(request, authorization)
            risk_level = "medium"
        else:
            content, reasoning_summary, cards, next_actions, tool_events = await self._handle_health(request, authorization)
            risk_level = "medium"

        run = self._build_run(
            thread_id=thread_id,
            risk_level=risk_level,
            tool_events=tool_events,
            cards=cards,
            content=content,
            reasoning_summary=reasoning_summary,
        )
        await self.store.save_run(run, authorization)
        message = await self._append_assistant_message(thread_id, content, reasoning_summary, cards, authorization)

        return PostMessageResponse(
            id=message.id,
            content=message.content,
            reasoning_summary=message.reasoning_summary or reasoning_summary,
            cards=cards,
            run_id=run.id,
            tool_events=tool_events,
            next_actions=next_actions,
            risk_level=risk_level,
        )

    async def approve_proposal(self, proposal_id: str, authorization: str | None = None) -> ProposalDecisionResponse:
        confirmed = await self.store.confirm_proposal(proposal_id, str(uuid.uuid4()), authorization)
        proposal = confirmed["proposal"]
        execution = confirmed["execution"]
        ok = bool(execution.get("ok"))
        result_payload = execution.get("result")
        execution_status = str(execution.get("status") or ("executed" if ok else "failed"))
        proposal_status = str(proposal.get("status") or execution_status)

        if ok:
            title = "提案已执行"
            description = "这条提案已经通过后端命令执行完成，数据库状态已更新。"
            content = f"我已经执行了“{proposal['title']}”，你现在可以刷新 dashboard、计划页或日志页查看最新数据。"
            reasoning_summary = "这次操作已通过单次确认链路写入数据库，并记录了执行结果。"
        else:
            title = "提案执行失败"
            description = "提案没有成功写入数据库，请根据错误信息重新生成或重试。"
            content = f"我尝试执行“{proposal['title']}”时失败了，请重新生成这条提案后再试。"
            reasoning_summary = "执行阶段返回失败，因此这次不把它视为成功写库。"

        cards = [self._build_result_card(proposal_id, title, description, result_payload, proposal_status)]
        message = await self._append_assistant_message(
            str(proposal["thread_id"]),
            content,
            reasoning_summary,
            cards,
            authorization,
        )
        self.trace.log(
            user_id=self._extract_user_id_from_authorization(authorization),
            proposal_id=proposal_id,
            action="confirm",
            ok=ok,
            status=execution_status,
        )
        return ProposalDecisionResponse(
            id=message.id,
            content=message.content,
            reasoning_summary=reasoning_summary,
            cards=cards,
            proposal_id=proposal_id,
            status=proposal_status,
        )

    async def approve_proposal_group(self, proposal_group_id: str, authorization: str | None = None) -> ProposalDecisionResponse:
        confirmed = await self.store.confirm_proposal_group(proposal_group_id, str(uuid.uuid4()), authorization)
        proposal_group = confirmed["proposal_group"]
        execution = confirmed["execution"]
        ok = bool(execution.get("ok"))
        status = str(proposal_group.get("status") or execution.get("status") or ("executed" if ok else "failed"))

        if ok:
            content = f"我已经执行了“{proposal_group['title']}”，下周计划、饮食和建议快照现在都已经同步到数据库。"
            reasoning_summary = "这次通过单次确认执行了整包 coaching package，并在后端完成了统一落库。"
            card = Card(
                type="coaching_package_card",
                title="教练包已执行",
                description="这次整包建议已经写入数据库。",
                bullets=self._preview_to_bullets(execution) or ["整包建议已成功应用。"],
                data={"proposalGroupId": proposal_group_id, "status": status, "result": execution},
            )
        else:
            content = f"我尝试执行“{proposal_group['title']}”时失败了，请重新生成一份新的教练包后再试。"
            reasoning_summary = "整包执行在后端失败，因此这次不把它视为成功应用。"
            card = Card(
                type="coaching_package_card",
                title="教练包执行失败",
                description="整包建议没有成功写入数据库。",
                bullets=self._preview_to_bullets(execution) or ["请重新生成教练包后再试。"],
                data={"proposalGroupId": proposal_group_id, "status": status, "result": execution},
            )

        message = await self._append_assistant_message(
            str(proposal_group["thread_id"]),
            content,
            reasoning_summary,
            [card],
            authorization,
        )
        self.trace.log(
            user_id=self._extract_user_id_from_authorization(authorization),
            proposal_group_id=proposal_group_id,
            action="confirm_package",
            ok=ok,
            status=status,
        )
        return ProposalDecisionResponse(
            id=message.id,
            content=message.content,
            reasoning_summary=reasoning_summary,
            cards=[card],
            proposal_id="",
            proposal_group_id=proposal_group_id,
            status=status,
        )

    async def reject_proposal(self, proposal_id: str, authorization: str | None = None) -> ProposalDecisionResponse:
        proposal = await self.store.reject_proposal(proposal_id, authorization)
        content = f"我已经拒绝了“{proposal['title']}”，数据库不会发生任何改动。"
        reasoning_summary = "这条提案被显式拒绝了，因此执行链路在审批阶段结束。"
        cards = [
            self._build_result_card(
                proposal_id=proposal_id,
                title="提案已拒绝",
                description="这次操作不会写入数据库。",
                result_payload=proposal.get("preview", {}),
                status="rejected",
            )
        ]
        message = await self._append_assistant_message(
            str(proposal["thread_id"]),
            content,
            reasoning_summary,
            cards,
            authorization,
        )
        self.trace.log(
            user_id=self._extract_user_id_from_authorization(authorization),
            proposal_id=proposal_id,
            action="reject",
            ok=True,
            status="rejected",
        )
        return ProposalDecisionResponse(
            id=message.id,
            content=message.content,
            reasoning_summary=reasoning_summary,
            cards=cards,
            proposal_id=proposal_id,
            status="rejected",
        )

    async def reject_proposal_group(self, proposal_group_id: str, authorization: str | None = None) -> ProposalDecisionResponse:
        proposal_group = await self.store.reject_proposal_group(proposal_group_id, authorization)
        content = f"我已经拒绝了“{proposal_group['title']}”，这次整包建议不会写入数据库。"
        reasoning_summary = "教练包被显式拒绝了，因此整包执行链路在审批阶段结束。"
        card = Card(
            type="coaching_package_card",
            title="教练包已拒绝",
            description="这次整包建议不会写入数据库。",
            bullets=self._preview_to_bullets(proposal_group.get("preview", {})) or ["整包建议已取消。"],
            data={"proposalGroupId": proposal_group_id, "status": "rejected", "preview": proposal_group.get("preview", {})},
        )
        message = await self._append_assistant_message(
            str(proposal_group["thread_id"]),
            content,
            reasoning_summary,
            [card],
            authorization,
        )
        self.trace.log(
            user_id=self._extract_user_id_from_authorization(authorization),
            proposal_group_id=proposal_group_id,
            action="reject_package",
            ok=True,
            status="rejected",
        )
        return ProposalDecisionResponse(
            id=message.id,
            content=message.content,
            reasoning_summary=reasoning_summary,
            cards=[card],
            proposal_id="",
            proposal_group_id=proposal_group_id,
            status="rejected",
        )

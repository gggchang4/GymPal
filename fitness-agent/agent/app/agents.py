from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Literal

from .config import settings
from .llm import OpenAICompatibleLLMClient, StructuredLLMResult
from .models import Card, MessageRecord, PostMessageRequest, PostMessageResponse, ProposalDecisionResponse, RunRecord, RunStep, ToolEvent
from .session_store import SessionStore
from .tool_gateway import ToolGateway, compute_place_rank
from .trace_logger import TraceLogger


logger = logging.getLogger("health_agent.runtime")


AgentIntent = Literal[
    "direct_answer",
    "fitness_knowledge",
    "exercise_instruction",
    "nutrition_advice",
    "workout_plan",
    "meal_plan",
    "user_data_query",
    "clarification_needed",
    "safety_sensitive",
    "out_of_scope",
]


class HealthAgentRuntime:
    CONTEXT_RECENT_MESSAGE_LIMIT = 12
    CONTEXT_TOTAL_CHAR_BUDGET = 6000
    CONTEXT_MESSAGE_CHAR_LIMIT = 900
    THREAD_SUMMARY_CHAR_LIMIT = 1000
    SUMMARY_SOURCE_CHAR_BUDGET = 6000
    SUMMARY_MIN_OLDER_MESSAGES = 4

    ACTION_TYPES = {
        "generate_plan",
        "adjust_plan",
        "create_plan_day",
        "update_plan_day",
        "delete_plan_day",
        "complete_plan_day",
        "create_body_metric",
        "create_daily_checkin",
        "create_diet_log",
        "create_workout_log",
        "generate_next_week_plan",
        "generate_diet_snapshot",
        "create_advice_snapshot",
        "create_coaching_memory",
        "update_coaching_memory",
        "archive_coaching_memory",
        "create_recommendation_feedback",
        "refresh_coaching_outcome",
    }

    LOCATION_KEYWORDS = ("附近", "周围", "公园", "步道", "游泳", "健身房", "gym", "park")
    PLAN_KEYWORDS = ("计划", "安排", "本周", "下周", "todo", "待办", "训练日", "plan")
    EXERCISE_KEYWORDS = ("动作", "替代", "深蹲", "卧推", "拉伸", "exercise")
    HIGH_RISK_KEYWORDS = ("胸痛", "晕厥", "处方", "药物", "极端减肥")
    MODERN_INTENT_NAMES = {
        "direct_answer",
        "fitness_knowledge",
        "exercise_instruction",
        "nutrition_advice",
        "workout_plan",
        "meal_plan",
        "user_data_query",
        "clarification_needed",
        "safety_sensitive",
        "out_of_scope",
    }
    WORKOUT_PLAN_VERBS = (
        "制定",
        "生成",
        "创建",
        "规划",
        "安排",
        "设计",
        "做一个",
        "做一份",
        "出一个",
        "冲一下",
        "排一下",
        "排一排",
        "帮我排",
        "给我排",
        "定制",
    )
    WORKOUT_PLAN_NOUNS = (
        "训练计划",
        "健身计划",
        "运动计划",
        "增肌计划",
        "减脂计划",
        "力量计划",
        "跑步计划",
        "训练日程",
        "训练安排",
        "怎么练",
        "每天练",
        "每周练",
        "一周练",
        "4周",
        "四周",
    )
    MEAL_PLAN_VERBS = WORKOUT_PLAN_VERBS
    MEAL_PLAN_NOUNS = (
        "饮食计划",
        "饮食方案",
        "减脂餐",
        "增肌餐",
        "食谱",
        "餐单",
        "吃饭计划",
        "怎么吃",
        "每天吃",
        "一周饮食",
        "meal plan",
        "nutrition plan",
        "diet plan",
    )
    NUTRITION_QUESTION_MARKERS = (
        "咖啡",
        "蛋白粉",
        "米饭",
        "碳水",
        "蛋白",
        "脂肪",
        "热量",
        "饮食",
        "早餐",
        "早饭",
        "午餐",
        "午饭",
        "晚餐",
        "晚饭",
        "加餐",
        "食物",
        "食材",
        "餐食",
        "减脂期间",
        "增肌期间",
        "吃",
        "喝",
        "补剂",
        "肌酸",
    )
    EXERCISE_INSTRUCTION_MARKERS = (
        "深蹲",
        "卧推",
        "硬拉",
        "划船",
        "引体",
        "俯卧撑",
        "肩推",
        "动作",
        "姿势",
        "发力",
        "代偿",
        "避免",
        "纠正",
        "标准",
    )
    FITNESS_KNOWLEDGE_MARKERS = (
        "有氧",
        "无氧",
        "力量训练",
        "酸痛",
        "拉伸",
        "热身",
        "恢复",
        "新手",
        "一周",
        "训练频率",
        "练几次",
        "先做",
        "后做",
        "rpe",
        "rm",
        "bmi",
    )
    USER_DATA_QUERY_MARKERS = (
        "我的",
        "我最近",
        "最近",
        "当前",
        "现在",
        "今天",
        "明天",
        "昨天",
        "本周",
        "上周",
        "历史",
        "记录",
        "计划里",
        "练什么",
        "吃了什么",
    )
    OUT_OF_SCOPE_MARKERS = ("写代码", "股票", "天气", "翻译", "数学题", "电影", "旅游攻略")
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
    OPERATION_MARKERS = (
        "记录",
        "录入",
        "保存",
        "写入",
        "记一下",
        "记一条",
        "生成",
        "创建",
        "新增",
        "添加",
        "调整",
        "修改",
        "删除",
        "标记",
        "完成",
        "安排一下",
        "帮我安排",
        "log",
        "record",
        "save",
        "generate",
        "create",
        "adjust",
        "modify",
        "delete",
        "remember",
    )
    MEMORY_EXPLICIT_MARKERS = (
        "记住",
        "帮我记",
        "以后请",
        "以后不要",
        "以后别",
        "请以后",
        "我的偏好",
        "我偏好",
        "remember",
        "please remember",
    )
    SAFETY_CLARIFY_MARKERS = (
        "胸痛",
        "晕厥",
        "头晕",
        "膝盖疼",
        "膝盖痛",
        "腰疼",
        "腰痛",
        "受伤",
        "疼痛",
        "麻木",
        "刺痛",
        "扭伤",
        "拉伤",
        "极端减肥",
        "800卡",
        "chest pain",
        "faint",
        "dizzy",
        "injury",
        "pain",
        "prescription",
    )
    PLAN_GOAL_MARKERS = (
        "减脂",
        "增肌",
        "力量",
        "耐力",
        "恢复",
        "塑形",
        "跑步",
        "有氧",
        "fat loss",
        "muscle",
        "strength",
        "endurance",
        "hypertrophy",
    )
    PLAN_FREQUENCY_MARKERS = (
        "每天",
        "本周",
        "下周",
        "一周",
        "每周",
        "周一",
        "周二",
        "周三",
        "周四",
        "周五",
        "week",
        "weekly",
    )
    PLAN_ADJUSTMENT_MARKERS = (
        "轻",
        "重",
        "换",
        "替换",
        "不要",
        "减少",
        "增加",
        "删除",
        "完成",
        "不伤",
        "lighter",
        "heavier",
        "replace",
        "remove",
    )
    WORKOUT_DETAIL_MARKERS = (
        "练了",
        "训练了",
        "上肢",
        "下肢",
        "胸",
        "背",
        "腿",
        "肩",
        "跑步",
        "游泳",
        "力量",
        "有氧",
        "rpe",
        "workout",
        "run",
        "lift",
    )
    CHECKIN_DETAIL_MARKERS = (
        "睡",
        "步",
        "喝水",
        "疲劳",
        "累",
        "疼",
        "痛",
        "精神",
        "状态",
        "心情",
        "sleep",
        "steps",
        "fatigue",
        "energy",
        "mood",
        "pain",
    )
    BODY_METRIC_MARKERS = ("体重", "体脂", "腰围", "kg", "公斤", "斤", "cm", "weight", "body fat")
    DIET_DETAIL_MARKERS = ("早餐", "午饭", "晚饭", "加餐", "吃了", "热量", "卡", "蛋白", "碳水", "meal", "calorie", "protein")
    INTENT_NAMES = {
        "direct_answer",
        "fitness_knowledge",
        "exercise_instruction",
        "nutrition_advice",
        "workout_plan",
        "meal_plan",
        "user_data_query",
        "clarification_needed",
        "safety_sensitive",
        "out_of_scope",
        "health_answer",
        "plan_answer",
        "plan_generate",
        "plan_adjust",
        "workout_log",
        "checkin_log",
        "body_metric_log",
        "diet_log",
        "memory_save",
        "weekly_review",
        "daily_guidance",
        "exercise_search",
        "location_search",
        "unclear",
    }
    WRITE_INTENT_TO_DOMAIN = {
        "workout_plan": "plan",
        "meal_plan": "meal_plan",
        "plan_generate": "plan",
        "plan_adjust": "plan",
        "workout_log": "workout_log",
        "checkin_log": "daily_checkin",
        "body_metric_log": "body_metric",
        "diet_log": "diet_log",
        "memory_save": "memory",
    }
    PLANNER_TOOL_WHITELIST = {
        "get_coach_summary",
        "load_current_plan",
        "get_memory_summary",
        "get_workspace_summary",
        "get_exercise_catalog",
        "get_recovery_guidance",
        "geocode_location",
        "reverse_geocode",
        "search_nearby_places",
        "create_action_proposal",
    }
    SUPPORTED_WRITE_DOMAINS = {
        "body_metric",
        "daily_checkin",
        "workout_log",
        "plan",
        "meal_plan",
        "memory",
        "diet_log",
    }
    PLANNER_TOOL_ARGUMENT_ALLOWLIST = {
        "get_coach_summary": set(),
        "load_current_plan": set(),
        "get_workspace_summary": set(),
        "get_exercise_catalog": set(),
        "get_memory_summary": {"categories", "tags", "include_expired"},
        "get_recovery_guidance": {"fatigue_level"},
        "geocode_location": {"location"},
        "reverse_geocode": {"latitude", "longitude"},
        "search_nearby_places": {"keyword", "latitude", "longitude", "location_hint"},
        "create_action_proposal": {"write_domain"},
    }

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
        payload["ok"] = tool_response.ok
        payload["source"] = tool_response.source
        if not tool_response.ok:
            if tool_response.error_code:
                payload["error_code"] = tool_response.error_code
            payload["retryable"] = tool_response.retryable
        return payload

    @staticmethod
    def _llm_metadata_payload(result: StructuredLLMResult | None, stage: str) -> dict[str, Any]:
        if result is None:
            return {"stage": stage, "ok": False, "fallback_used": True, "error_code": "not_attempted"}
        return {
            "stage": stage,
            "ok": result.ok,
            "model_id": result.model_id,
            "base_url": result.base_url,
            "latency_ms": result.latency_ms,
            "error_code": result.error_code,
            "error_message": result.error_message,
            "fallback_used": result.fallback_used,
        }

    @staticmethod
    def _coerce_confidence(value: Any, fallback: float = 0.0) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return fallback
        return max(0.0, min(1.0, number))

    def _coerce_intent(self, value: Any) -> str:
        intent = str(value or "").strip()
        return intent if intent in self.INTENT_NAMES else "unclear"

    def _normalize_write_domain(
        self,
        value: Any,
        intent: str | None = None,
        fallback: Any = None,
    ) -> str | None:
        domain = str(value or "").strip().lower().replace("-", "_")
        fallback_domain = str(fallback or "").strip().lower().replace("-", "_")
        intent_name = str(intent or "")

        if domain in self.SUPPORTED_WRITE_DOMAINS:
            return domain
        if domain in {"meal", "nutrition", "diet", "diet_plan", "nutrition_plan"}:
            if intent_name == "diet_log":
                return "diet_log"
            if intent_name == "meal_plan":
                return "meal_plan"
            if fallback_domain in self.SUPPORTED_WRITE_DOMAINS:
                return fallback_domain
            return "meal_plan"
        if domain in {"fitness", "exercise"}:
            if intent_name in {"plan_generate", "plan_adjust", "workout_plan"}:
                return "plan"
            if intent_name == "exercise_search":
                return None
            if fallback_domain in self.SUPPORTED_WRITE_DOMAINS:
                return fallback_domain
            return None
        if domain in {"training", "workout"}:
            if intent_name == "workout_log":
                return "workout_log"
            if intent_name in {"plan_generate", "plan_adjust"}:
                return "plan"
            if fallback_domain in self.SUPPORTED_WRITE_DOMAINS:
                return fallback_domain
            return None
        if fallback_domain:
            return self._normalize_write_domain(fallback_domain, intent=intent_name)
        return None

    def _sanitize_tool_arguments(self, tool_name: str, arguments: Any) -> dict[str, Any]:
        if not isinstance(arguments, dict):
            return {}
        allowed = self.PLANNER_TOOL_ARGUMENT_ALLOWLIST.get(tool_name)
        if allowed is None:
            return {}
        return {key: value for key, value in arguments.items() if key in allowed}

    @staticmethod
    def _coerce_bool(value: Any) -> bool:
        return value is True or (isinstance(value, str) and value.lower() == "true")

    @staticmethod
    def _string_list(value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str) and value.strip():
            return [value.strip()]
        return []

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

    def _fallback_intent_from_keywords(self, text: str) -> dict[str, Any]:
        write_domain = self._detect_write_domain(text)
        if self._is_explicit_meal_plan_request(text):
            intent = "meal_plan"
            write_domain = "meal_plan"
        elif self._is_exercise_recommendation_request(text):
            intent = "exercise_search"
            write_domain = None
        elif self._is_weekly_review_request(text):
            intent = "weekly_review"
        elif self._is_daily_guidance_request(text):
            intent = "daily_guidance"
        elif write_domain == "memory":
            intent = "memory_save"
        elif write_domain == "body_metric":
            intent = "body_metric_log"
        elif write_domain == "daily_checkin":
            intent = "checkin_log"
        elif write_domain == "workout_log":
            intent = "workout_log"
        elif write_domain == "diet_log":
            intent = "diet_log"
        elif write_domain == "plan":
            intent = "plan_generate" if any(verb in text for verb in ("生成", "创建", "制定", "规划", "安排", "排", "新增", "添加")) else "plan_adjust"
        elif self._is_location_query(text):
            intent = "location_search"
        elif self._is_exercise_query(text):
            intent = "exercise_search"
        elif self._is_plan_query(text):
            intent = "plan_answer"
        else:
            intent = "health_answer"

        return {
            "intent": intent,
            "confidence": 0.6 if intent != "health_answer" else 0.45,
            "referenced_context": [],
            "missing_fields": [],
            "risk_flags": [keyword for keyword in self.HIGH_RISK_KEYWORDS if keyword in text],
            "should_clarify": False,
            "clarifying_question": "",
            "write_domain": write_domain or self.WRITE_INTENT_TO_DOMAIN.get(intent),
            "source": "keyword_fallback",
        }

    def _normalize_intent_result(self, raw: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
        intent = self._coerce_intent(raw.get("intent"))
        agent_intent = str(raw.get("agent_intent") or "").strip()
        if intent in self.MODERN_INTENT_NAMES and not agent_intent:
            agent_intent = intent
        if agent_intent not in self.MODERN_INTENT_NAMES:
            agent_intent = str(fallback.get("agent_intent") or "").strip()
        if agent_intent not in self.MODERN_INTENT_NAMES:
            agent_intent = "direct_answer" if intent == "health_answer" else ""
        if intent == "clarification_needed":
            intent = "unclear"
        confidence = self._coerce_confidence(raw.get("confidence"), fallback=float(fallback.get("confidence") or 0.0))
        write_domain = self._normalize_write_domain(
            raw.get("write_domain"),
            intent=intent,
            fallback=self.WRITE_INTENT_TO_DOMAIN.get(intent) or fallback.get("write_domain"),
        )
        if intent in {"direct_answer", "fitness_knowledge", "exercise_instruction", "nutrition_advice", "safety_sensitive", "out_of_scope"}:
            write_domain = None
        should_clarify = self._coerce_bool(raw.get("should_clarify")) or intent == "unclear" or confidence < 0.55
        clarifying_question = str(raw.get("clarifying_question") or "").strip()
        if should_clarify and not clarifying_question:
            clarifying_question = "我想确认一下：你希望我回答问题、调整计划，还是记录一条健康/训练数据？"

        return {
            "intent": intent,
            "agent_intent": agent_intent or None,
            "confidence": confidence,
            "referenced_context": self._string_list(raw.get("referenced_context")),
            "missing_fields": self._string_list(raw.get("missing_fields")),
            "risk_flags": self._string_list(raw.get("risk_flags")),
            "should_clarify": should_clarify,
            "clarifying_question": clarifying_question,
            "write_domain": str(write_domain) if write_domain else None,
            "source": "llm_classifier",
        }

    @staticmethod
    def _contains_marker(text: str, markers: tuple[str, ...]) -> bool:
        lowered = text.lower()
        return any(marker in text or marker in lowered for marker in markers)

    @staticmethod
    def _has_digit(text: str) -> bool:
        return any(char.isdigit() for char in text)

    @staticmethod
    def _conversation_texts_by_role(conversation_context: dict[str, Any], role: str) -> list[str]:
        messages = conversation_context.get("recent_messages")
        if not isinstance(messages, list):
            return []
        texts: list[str] = []
        for message in messages:
            if not isinstance(message, dict):
                continue
            if str(message.get("role") or "").lower() != role:
                continue
            content = str(message.get("content") or "").strip()
            if content:
                texts.append(content)
        return texts

    @staticmethod
    def _detect_plan_goal(text: str) -> str | None:
        lowered = text.lower()
        if any(marker in text for marker in ("增肌", "长肌肉", "肌肥大")) or any(marker in lowered for marker in ("muscle", "hypertrophy")):
            return "muscle_gain"
        if any(marker in text for marker in ("减脂", "减肥", "掉脂")) or any(marker in lowered for marker in ("fat loss", "lose fat", "cutting")):
            return "fat_loss"
        if any(marker in text for marker in ("力量", "大重量")) or "strength" in lowered:
            return "strength"
        if any(marker in text for marker in ("耐力", "心肺")) or "endurance" in lowered:
            return "endurance"
        if any(marker in text for marker in ("维持", "保持")) or "maintenance" in lowered:
            return "maintenance"
        return None

    @staticmethod
    def _detect_plan_focus(text: str) -> str | None:
        lowered = text.lower()
        focus_markers = [
            ("chest", ("练胸", "胸部", "胸肌", "胸日", "chest", "pec")),
            ("back", ("练背", "背部", "背阔", "back")),
            ("legs", ("练腿", "腿部", "臀腿", "leg", "legs")),
            ("shoulders", ("练肩", "肩部", "shoulder")),
            ("arms", ("手臂", "二头", "三头", "arms", "biceps", "triceps")),
            ("push", ("推力", "推日", "推类", "推举", "push")),
            ("pull", ("拉力", "拉日", "拉类", "下拉", "划船", "pull")),
            ("full_body", ("全身", "全身训练", "full body")),
        ]
        for value, markers in focus_markers:
            if any(marker in text or marker in lowered for marker in markers):
                return value
        return None

    @staticmethod
    def _detect_plan_frequency(text: str) -> str | None:
        lowered = text.lower()
        if any(marker in text for marker in ("今天一次", "一次", "单次", "练胸日", "胸日", "训练日")) or any(
            marker in lowered for marker in ("today", "single session", "one session")
        ):
            return "single_session"
        match = re.search(r"(\d+)\s*(天|次|day|days|x)", text, flags=re.IGNORECASE)
        if match:
            return f"{match.group(1)}_sessions"
        chinese_number_match = re.search(r"(一|二|两|三|四|五|六|七)\s*(天|次|练)", text)
        if chinese_number_match:
            return f"{chinese_number_match.group(1)}_sessions"
        if any(marker in text for marker in ("每周", "一周", "下周", "本周")) or any(marker in lowered for marker in ("weekly", "week")):
            return "weekly"
        return None

    @staticmethod
    def _detect_plan_equipment(text: str) -> str | None:
        lowered = text.lower()
        if any(marker in text for marker in ("都可以", "都行", "不限", "均可")) or "any" in lowered:
            return "any"
        if any(marker in text for marker in ("固定器械", "器械", "史密斯")) or "machine" in lowered:
            return "machines"
        if any(marker in text for marker in ("杠铃", "哑铃", "自由重量")) or any(marker in lowered for marker in ("barbell", "dumbbell", "free weight")):
            return "free_weights"
        if any(marker in text for marker in ("徒手", "自重")) or "bodyweight" in lowered:
            return "bodyweight"
        return None

    def _is_plan_generation_request(self, text: str) -> bool:
        lowered = text.lower()
        has_plan_marker = any(marker in text for marker in ("计划", "训练日", "练胸日")) or "plan" in lowered
        has_generate_marker = any(marker in text for marker in ("生成", "创建", "制定", "安排", "整理", "排")) or any(
            marker in lowered for marker in ("generate", "create", "build", "make")
        )
        return has_plan_marker and has_generate_marker

    def _is_explicit_workout_plan_request(self, text: str) -> bool:
        lowered = text.lower()
        if self._is_explicit_meal_plan_request(text):
            return False

        has_plan_noun = self._contains_marker(text, self.WORKOUT_PLAN_NOUNS) or any(
            marker in lowered for marker in ("workout plan", "training plan", "fitness plan", "program")
        )
        has_plan_verb = self._contains_marker(text, self.WORKOUT_PLAN_VERBS) or any(
            marker in lowered for marker in ("make me", "build me", "create", "generate", "schedule", "program")
        )
        has_training_domain = any(marker in text for marker in ("训练", "健身", "增肌", "减脂", "力量", "有氧", "无氧", "练"))
        explicit_schedule_phrase = any(marker in text for marker in ("帮我排", "给我排", "排一下", "排一排", "每天怎么练"))

        if has_plan_noun and has_plan_verb:
            return True
        if explicit_schedule_phrase and has_training_domain:
            return True
        return False

    def _is_explicit_meal_plan_request(self, text: str) -> bool:
        lowered = text.lower()
        has_plan_noun = self._contains_marker(text, self.MEAL_PLAN_NOUNS)
        has_plan_verb = self._contains_marker(text, self.MEAL_PLAN_VERBS) or any(
            marker in lowered for marker in ("make me", "build me", "create", "generate")
        )
        return has_plan_noun and has_plan_verb

    def _is_nutrition_advice_request(self, text: str) -> bool:
        lowered = text.lower()
        if not self._is_plain_read_only_question(text):
            return False
        return self._contains_marker(text, self.NUTRITION_QUESTION_MARKERS) or any(
            marker in lowered
            for marker in (
                "protein",
                "calorie",
                "carb",
                "coffee",
                "creatine",
                "breakfast",
                "lunch",
                "dinner",
                "meal",
                "snack",
                "food",
            )
        )

    def _has_diet_log_write_signal(self, text: str) -> bool:
        lowered = text.lower()
        if not self._contains_marker(text, self.DIET_DETAIL_MARKERS):
            return False

        explicit_log_markers = (
            "记录",
            "录入",
            "保存",
            "写入",
            "记一下",
            "记一条",
            "帮我记",
            "log",
            "record",
            "save",
        )
        consumption_markers = (
            "吃了",
            "喝了",
            "吃的是",
            "喝的是",
            "摄入",
            "早餐吃",
            "早饭吃",
            "午餐吃",
            "午饭吃",
            "晚餐吃",
            "晚饭吃",
            "加餐吃",
            "早餐是",
            "早饭是",
            "午餐是",
            "午饭是",
            "晚餐是",
            "晚饭是",
            "加餐是",
        )
        macro_markers = ("热量", "卡", "千卡", "kcal", "蛋白", "碳水", "脂肪", "calorie", "protein", "carb", "fat")
        return (
            any(marker in text or marker in lowered for marker in explicit_log_markers)
            or any(marker in text for marker in consumption_markers)
            or (self._has_digit(text) and self._contains_marker(text, macro_markers))
        )

    def _is_vague_operation_request(self, text: str) -> bool:
        stripped = text.strip()
        if stripped.endswith(("?", "？", "吗")):
            return False
        vague_markers = ("帮我安排一个", "帮我做一个", "给我安排一个", "安排一个", "做一个", "排一下")
        has_vague_marker = any(marker in text for marker in vague_markers)
        has_domain_marker = any(
            marker in text
            for marker in (
                "训练",
                "健身",
                "饮食",
                "餐",
                "计划",
                "记录",
                "体重",
                "睡眠",
                "动作",
            )
        )
        return has_vague_marker and not has_domain_marker

    def _is_contextual_plan_followup(self, text: str) -> bool:
        stripped = text.strip()
        if not stripped:
            return False
        if self._is_explicit_workout_plan_request(stripped) or self._is_plan_generation_request(stripped):
            return True

        lowered = stripped.lower()
        followup_markers = (
            "那个",
            "这个",
            "刚才",
            "上面",
            "前面",
            "之前",
            "这份",
            "按刚才",
            "改一下",
            "调整一下",
            "换一下",
            "轻一点",
            "重一点",
            "不要跑跳",
            "不伤",
        )
        if self._contains_marker(stripped, followup_markers):
            return True

        if self._is_plain_read_only_question(stripped):
            return False

        if len(stripped) <= 24 and (
            self._contains_marker(stripped, self.PLAN_GOAL_MARKERS)
            or self._contains_marker(stripped, self.PLAN_FREQUENCY_MARKERS)
            or self._detect_plan_equipment(stripped) is not None
            or self._detect_plan_focus(stripped) is not None
            or bool(re.search(r"\d+\s*(天|次|day|days|x)", stripped, flags=re.IGNORECASE))
            or any(marker in lowered for marker in ("bodyweight", "dumbbell", "barbell", "machine"))
        ):
            return True

        return False

    def _is_exercise_recommendation_request(self, text: str) -> bool:
        lowered = text.lower()
        has_exercise_marker = self._contains_marker(text, self.EXERCISE_KEYWORDS) or any(
            marker in text for marker in ("练胸", "练背", "练腿", "练肩", "胸部", "背部", "臀腿", "上肢", "下肢")
        )
        has_recommend_marker = any(marker in text for marker in ("推荐", "给我一些", "给我几个", "有哪些", "有什么", "动作推荐")) or any(
            marker in lowered for marker in ("recommend", "suggest", "what exercises", "which exercises")
        )
        has_write_marker = any(marker in text for marker in ("记录", "保存", "写入", "生成计划", "新增", "添加到计划")) or any(
            marker in lowered for marker in ("record", "save", "write", "generate plan", "add to plan")
        )
        return has_exercise_marker and has_recommend_marker and not has_write_marker

    def _is_delete_all_plan_request(self, text: str) -> bool:
        lowered = text.lower()
        has_plan_marker = self._contains_marker(text, self.PLAN_KEYWORDS)
        has_delete_marker = any(marker in text for marker in ("删除", "删掉", "移除", "清空", "清除", "删光")) or any(
            marker in lowered for marker in ("delete", "remove", "clear")
        )
        has_all_marker = any(marker in text for marker in ("所有", "全部", "整个", "整份", "当前计划")) or any(
            marker in lowered for marker in ("all", "entire", "whole", "current plan")
        )
        has_clear_marker = any(marker in text for marker in ("清空", "清除", "删光")) or "clear" in lowered
        return has_plan_marker and has_delete_marker and (has_all_marker or has_clear_marker)

    def _is_strong_keyword_write_intent(self, text: str, fallback: dict[str, Any]) -> bool:
        write_domain = str(fallback.get("write_domain") or "")
        intent_name = str(fallback.get("intent") or "")
        if not write_domain:
            return False

        lowered = text.lower()
        has_operation_marker = self._contains_marker(text, self.OPERATION_MARKERS)

        if write_domain == "body_metric":
            return self._contains_marker(text, self.BODY_METRIC_MARKERS) and (has_operation_marker or self._has_digit(text))
        if write_domain == "daily_checkin":
            return has_operation_marker and self._contains_marker(text, self.CHECKIN_DETAIL_MARKERS)
        if write_domain == "workout_log":
            return has_operation_marker and (
                self._contains_marker(text, self.WORKOUT_DETAIL_MARKERS) or "训练记录" in text or "workout log" in lowered
            )
        if write_domain == "diet_log":
            return self._has_diet_log_write_signal(text)
        if write_domain == "meal_plan":
            return self._is_explicit_meal_plan_request(text)
        if write_domain == "memory":
            return self._has_explicit_memory_request(text)
        if write_domain == "plan":
            if intent_name in {"plan_generate", "workout_plan"}:
                return self._is_plan_generation_request(text) or self._is_explicit_workout_plan_request(text)
            return self._is_delete_all_plan_request(text) or (
                self._contains_marker(text, self.PLAN_KEYWORDS)
                and (
                    self._contains_marker(text, self.PLAN_ADJUSTMENT_MARKERS)
                    or any(marker in text for marker in ("删掉", "移除", "清空", "清除", "标记"))
                    or any(marker in lowered for marker in ("delete plan", "remove plan", "clear plan", "mark complete"))
                )
            )
        return False

    def _is_plain_read_only_question(self, text: str) -> bool:
        lowered = text.lower()
        stripped = text.strip()
        chinese_markers = (
            "吗",
            "怎么",
            "如何",
            "为什么",
            "为何",
            "谁",
            "是谁",
            "能不能",
            "可不可以",
            "可以",
            "应该",
            "建议",
            "推荐",
            "有哪些",
            "有什么",
            "是什么",
            "区别",
            "多少",
            "几",
            "多久",
            "等于",
        )
        english_markers = (
            "how",
            "what",
            "why",
            "should",
            "can i",
            "could i",
            "recommend",
            "suggest",
            "which",
            "when",
            "do i need",
        )
        return stripped.endswith(("?", "？")) or any(marker in text for marker in chinese_markers) or any(
            marker in lowered for marker in english_markers
        )

    def _is_simple_math_question(self, text: str) -> bool:
        stripped = text.strip()
        lowered = stripped.lower()
        if not stripped:
            return False
        has_math_expression = bool(re.search(r"\d+\s*[\+\-\*/×÷]\s*\d+", stripped))
        has_question_marker = any(marker in stripped for marker in ("等于", "多少", "几", "?")) or "what is" in lowered
        return has_math_expression and has_question_marker

    def _is_general_direct_answer_request(self, text: str) -> bool:
        if self._is_simple_math_question(text):
            return True
        if not self._is_plain_read_only_question(text):
            return False

        contextual_followup_markers = (
            "那个",
            "这个",
            "刚才",
            "上面",
            "前面",
            "之前",
            "按刚才",
            "继续",
            "改一下",
            "换一下",
            "轻一点",
            "重一点",
        )
        if self._contains_marker(text, contextual_followup_markers):
            return False

        domain_markers = (
            *self.NUTRITION_QUESTION_MARKERS,
            *self.EXERCISE_INSTRUCTION_MARKERS,
            *self.FITNESS_KNOWLEDGE_MARKERS,
            *self.PLAN_KEYWORDS,
            *self.EXERCISE_KEYWORDS,
            *self.LOCATION_KEYWORDS,
            "健身",
            "训练",
            "锻炼",
            "运动",
            "动作",
            "饮食",
            "营养",
            "恢复",
            "疲劳",
            "很累",
            "累",
            "睡眠",
            "睡",
            "练",
            "体重",
            "体脂",
            "目标",
        )
        if self._contains_marker(text, domain_markers):
            return False

        write_markers = (
            "记录",
            "录入",
            "保存",
            "写入",
            "生成",
            "创建",
            "新增",
            "添加",
            "调整",
            "修改",
            "删除",
            "标记",
            "完成",
        )
        if self._contains_marker(text, write_markers):
            return False

        return True

    def _modern_intent_payload(
        self,
        *,
        agent_intent: AgentIntent,
        legacy_intent: str,
        confidence: float,
        write_domain: str | None = None,
        risk_flags: list[str] | None = None,
        should_clarify: bool = False,
        missing_fields: list[str] | None = None,
        clarifying_question: str = "",
        source: str = "modern_intent_router",
    ) -> dict[str, Any]:
        return {
            "intent": legacy_intent,
            "agent_intent": agent_intent,
            "confidence": confidence,
            "referenced_context": [],
            "missing_fields": missing_fields or [],
            "risk_flags": risk_flags or [],
            "should_clarify": should_clarify,
            "clarifying_question": clarifying_question,
            "write_domain": write_domain,
            "source": source,
        }

    def _modern_intent_from_keywords(
        self,
        text: str,
        fallback: dict[str, Any],
        conversation_context: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        lowered = text.lower()
        stripped = text.strip()
        if not stripped:
            return self._modern_intent_payload(
                agent_intent="clarification_needed",
                legacy_intent="unclear",
                confidence=0.9,
                should_clarify=True,
                clarifying_question="你想先问训练/饮食问题，还是让我帮你整理计划或记录数据？",
            )

        fallback_intent = str(fallback.get("intent") or "")
        is_question = self._is_plain_read_only_question(text)
        red_flag_markers = ("胸痛", "胸口疼", "晕厥", "晕倒", "头晕", "麻木", "刺痛", "处方", "药物", "800卡", "800 卡", "极低热量")
        if any(marker in text for marker in red_flag_markers) or any(marker in lowered for marker in ("chest pain", "faint", "dizzy", "prescription")):
            return self._modern_intent_payload(
                agent_intent="safety_sensitive",
                legacy_intent="health_answer",
                confidence=0.9,
                risk_flags=["red_flag"],
                should_clarify=True,
                missing_fields=["symptom_context"],
                clarifying_question="如果症状正在发生，先停止训练并及时就医。这个不适出现多久了，强度大概 0-10 分是多少？",
            )

        if (
            fallback.get("write_domain")
            and fallback_intent not in {"plan_generate", "meal_plan"}
            and not self._is_explicit_workout_plan_request(text)
            and not self._is_nutrition_advice_request(text)
        ):
            return None
        if fallback_intent in {"weekly_review", "daily_guidance"}:
            return None

        if self._is_general_direct_answer_request(text):
            return self._modern_intent_payload(
                agent_intent="direct_answer",
                legacy_intent="health_answer",
                confidence=0.86,
            )

        if self._is_explicit_meal_plan_request(text):
            return self._modern_intent_payload(
                agent_intent="meal_plan",
                legacy_intent="meal_plan",
                confidence=0.92,
                write_domain="meal_plan",
                missing_fields=[] if self._contains_marker(text, self.PLAN_GOAL_MARKERS) else ["goal"],
            )

        if self._is_explicit_workout_plan_request(text):
            safety_first = self._contains_marker(text, self.SAFETY_CLARIFY_MARKERS)
            missing_fields = [] if self._contains_marker(text, self.PLAN_GOAL_MARKERS) else ["goal"]
            if safety_first:
                missing_fields = self._dedupe_text_items([*missing_fields, "symptom_context"])
            return self._modern_intent_payload(
                agent_intent="workout_plan",
                legacy_intent="plan_generate",
                confidence=0.92,
                write_domain="plan",
                risk_flags=["pain_or_injury"] if safety_first else [],
                should_clarify=safety_first,
                missing_fields=missing_fields,
                clarifying_question="先确认安全边界：疼痛或不适的位置、程度和持续时间是什么？",
            )

        pain_markers = ("膝盖疼", "膝盖痛", "肩膀疼", "肩痛", "腰痛", "受伤", "拉伤", "扭伤")
        if any(marker in text for marker in pain_markers) or "pain" in lowered or "injury" in lowered:
            return self._modern_intent_payload(
                agent_intent="safety_sensitive",
                legacy_intent="health_answer",
                confidence=0.86,
                risk_flags=["pain_or_injury"],
            )

        if fallback_intent in {"exercise_search", "location_search", "plan_answer"}:
            return None

        if self._is_vague_operation_request(text):
            return self._modern_intent_payload(
                agent_intent="clarification_needed",
                legacy_intent="unclear",
                confidence=0.78,
                should_clarify=True,
                clarifying_question="你想让我安排训练、饮食，还是记录一条健康数据？",
            )

        if is_question and any(marker in text for marker in self.USER_DATA_QUERY_MARKERS) and any(
            marker in text for marker in ("我最近", "我的", "当前", "计划里", "历史", "记录", "明天练什么", "今天练什么")
        ):
            legacy_intent = "plan_answer" if any(marker in text for marker in ("计划", "练什么", "训练日")) else "health_answer"
            return self._modern_intent_payload(
                agent_intent="user_data_query",
                legacy_intent=legacy_intent,
                confidence=0.82,
                source="modern_context_route",
            )

        context_heavy_markers = ("今天", "明天", "昨晚", "最近", "本周", "当前", "现在", "恢复", "疲劳", "很累", "睡")
        if is_question and any(marker in text for marker in context_heavy_markers):
            return None

        if self._is_nutrition_advice_request(text):
            return self._modern_intent_payload(
                agent_intent="nutrition_advice",
                legacy_intent="health_answer",
                confidence=0.86,
            )

        if is_question and self._contains_marker(text, self.EXERCISE_INSTRUCTION_MARKERS):
            return self._modern_intent_payload(
                agent_intent="exercise_instruction",
                legacy_intent="health_answer",
                confidence=0.86,
            )

        if is_question and (self._contains_marker(text, self.FITNESS_KNOWLEDGE_MARKERS) or "fitness" in lowered or "workout" in lowered):
            return self._modern_intent_payload(
                agent_intent="fitness_knowledge",
                legacy_intent="health_answer",
                confidence=0.84,
            )

        if is_question and not self._contains_marker(text, self.OUT_OF_SCOPE_MARKERS):
            return self._modern_intent_payload(
                agent_intent="direct_answer",
                legacy_intent="health_answer",
                confidence=0.78,
            )

        if self._contains_marker(text, self.OUT_OF_SCOPE_MARKERS) and not any(
            marker in text for marker in ("健身", "训练", "饮食", "动作", "恢复")
        ):
            return self._modern_intent_payload(
                agent_intent="out_of_scope",
                legacy_intent="health_answer",
                confidence=0.8,
            )

        return None

    def _has_read_fast_path_blocker(self, text: str, intent_name: str) -> bool:
        if self._contains_marker(text, self.SAFETY_CLARIFY_MARKERS) or bool(
            re.search(r"(胸|膝|腰|背|肩).{0,4}(疼|痛|伤|不舒服)|(?:疼|痛|伤).{0,4}(胸|膝|腰|背|肩)", text)
        ):
            return True
        if any(marker in text for marker in ("现在", "当前", "待办", "复盘", "本周", "下周", "刚才", "那个", "第二天")):
            return True
        if intent_name == "health_answer" and any(
            marker in text for marker in ("今天", "明天", "昨晚", "睡", "累", "疲劳", "恢复", "酸痛", "怎么练", "怎么安排", "晚餐", "早餐", "午餐")
        ):
            return True
        if intent_name == "exercise_search" and any(
            marker in text for marker in ("疼", "痛", "伤", "不跳", "低冲击", "不伤", "膝", "腰", "替代")
        ):
            return True
        return intent_name in {"plan_answer", "location_search"}

    def _is_obvious_read_only_request(self, text: str, fallback: dict[str, Any]) -> bool:
        intent_name = str(fallback.get("intent") or "")
        if fallback.get("write_domain"):
            return False
        if intent_name in {"weekly_review", "daily_guidance", "unclear"}:
            return False
        if self._contains_marker(text, self.HIGH_RISK_KEYWORDS):
            return False
        if self._contains_marker(text, self.OPERATION_MARKERS):
            return False
        if self._has_read_fast_path_blocker(text, intent_name):
            return False
        if self._is_exercise_recommendation_request(text):
            return True
        if intent_name == "exercise_search":
            return True
        if intent_name != "health_answer" or not self._is_plain_read_only_question(text):
            return False
        return any(marker in text.lower() for marker in ("rpe", "rm", "bmi")) or any(
            marker in text for marker in ("解释", "是什么", "什么意思", "区别")
        )

    def _static_fast_read_payload(self, text: str, intent_name: str) -> dict[str, Any] | None:
        language = self._detect_reply_language(text)
        chinese = language == "Simplified Chinese"
        lowered = text.lower()

        if "rpe" in lowered:
            if chinese:
                return {
                    "content": "RPE 7 可以理解成“有点吃力，但还留着余力”：这一组做完后，大概还能再做 3 次左右。用在力量训练里，它适合技术练习、增肌主项的中等偏上强度，通常不需要练到力竭。\n\n如果你今天状态一般，就把主项控制在 RPE 6-7；状态很好再偶尔推到 RPE 8。长期训练里，RPE 7 是一个很稳的工作强度。",
                    "next_actions": ["告诉我你的训练动作", "帮我换算训练强度", "继续解释RPE 8"],
                    "card_title": "RPE 7",
                    "card_description": "中等偏上强度，通常还剩约 3 次余力。",
                    "card_bullets": ["主观感受：吃力但可控", "余力：大约还能做 3 次", "适合：技术稳定、不过度力竭的训练组"],
                }
            return {
                "content": "RPE 7 means the set feels challenging but controlled. You would usually have about 3 reps left in reserve, so it is useful for productive training without pushing to failure.\n\nOn an average day, keeping main work around RPE 6-7 is a steady choice. Save RPE 8+ for days when technique and recovery both feel solid.",
                "next_actions": ["Tell me your lift", "Convert my training intensity", "Explain RPE 8"],
                "card_title": "RPE 7",
                "card_description": "A controlled hard set with roughly 3 reps in reserve.",
                "card_bullets": ["Feels challenging but controlled", "Around 3 reps in reserve", "Good for productive non-failure work"],
            }

        if intent_name == "exercise_search" and self._is_exercise_recommendation_request(text):
            focus = self._detect_plan_focus(text) or "full_body"
            recommendations: dict[str, list[str]] = {
                "chest": ["俯卧撑", "杠铃卧推", "上斜哑铃卧推", "绳索夹胸"],
                "back": ["高位下拉", "坐姿划船", "哑铃划船", "面拉"],
                "legs": ["高脚杯深蹲", "罗马尼亚硬拉", "臀桥", "保加利亚分腿蹲"],
                "shoulders": ["哑铃推举", "侧平举", "反向飞鸟", "面拉"],
                "arms": ["哑铃弯举", "绳索下压", "锤式弯举", "窄距俯卧撑"],
                "full_body": ["深蹲", "俯卧撑", "划船", "平板支撑"],
            }
            names = recommendations.get(focus, recommendations["full_body"])
            if chinese:
                return {
                    "content": f"可以，先给你一组好上手的动作：{names[0]}、{names[1]}、{names[2]}、{names[3]}。\n\n如果你是增肌取向，每个动作做 3-4 组，每组 8-12 次，最后 2-3 次有点吃力但动作不变形就刚好。先从前 3 个动作开始就够了，不用一上来堆太多量。",
                    "next_actions": ["按器械条件细化", "安排成一次训练", "换成徒手版本"],
                    "card_title": "动作推荐",
                    "card_description": "先选 3-4 个动作，控制动作质量和渐进负重。",
                    "card_bullets": names,
                }
            return {
                "content": f"Sure. A simple set of options: {names[0]}, {names[1]}, {names[2]}, and {names[3]}.\n\nFor muscle gain, use 3-4 sets of 8-12 reps and keep the last few reps challenging without losing form. Start with three movements first; you do not need a huge menu to get a good session.",
                "next_actions": ["Adapt to my equipment", "Turn it into one session", "Make it bodyweight"],
                "card_title": "Exercise Picks",
                "card_description": "Pick 3-4 movements and keep the work controlled.",
                "card_bullets": names,
            }

        return None

    def _plan_generation_slots(self, current_text: str, conversation_context: dict[str, Any]) -> dict[str, Any]:
        user_texts = self._conversation_texts_by_role(conversation_context, "user")
        if current_text.strip() and (not user_texts or user_texts[-1] != current_text):
            user_texts.append(current_text)
        user_texts = user_texts[-8:]
        assistant_texts = self._conversation_texts_by_role(conversation_context, "assistant")[-6:]
        aggregate_text = "\n".join(user_texts)
        assistant_text = "\n".join(assistant_texts)
        active = any(self._is_plan_generation_request(text) for text in user_texts) or (
            "计划" in assistant_text and any(marker in assistant_text for marker in ("目标", "一周几天", "器械", "确认"))
        )
        goal = self._detect_plan_goal(aggregate_text)
        focus = self._detect_plan_focus(aggregate_text)
        frequency = self._detect_plan_frequency(aggregate_text)
        equipment = self._detect_plan_equipment(aggregate_text)
        if focus and not frequency and any(marker in aggregate_text for marker in ("练胸日", "训练日", "今天")):
            frequency = "single_session"
        return {
            "active": active,
            "goal": goal,
            "focus": focus,
            "frequency": frequency,
            "equipment": equipment,
            "aggregate_text": aggregate_text,
        }

    def _contextual_plan_intent(
        self,
        request: PostMessageRequest,
        conversation_context: dict[str, Any],
        fallback: dict[str, Any],
    ) -> dict[str, Any] | None:
        if self._is_general_direct_answer_request(request.text):
            return None
        if self._is_nutrition_advice_request(request.text):
            return None
        if self._is_exercise_recommendation_request(request.text):
            return None
        if not self._is_contextual_plan_followup(request.text):
            return None
        if self._is_strong_keyword_write_intent(request.text, fallback) and fallback.get("intent") != "plan_generate":
            return None

        slots = self._plan_generation_slots(request.text, conversation_context)
        user_texts = self._conversation_texts_by_role(conversation_context, "user")
        if user_texts and user_texts[-1] == request.text:
            user_texts = user_texts[:-1]
        assistant_text = "\n".join(self._conversation_texts_by_role(conversation_context, "assistant")[-6:])
        has_prior_plan_turn = any(self._is_plan_generation_request(text) for text in user_texts[-6:]) or (
            "计划" in assistant_text and any(marker in assistant_text for marker in ("目标", "一周几天", "器械", "确认"))
        )
        if not slots["active"] or not has_prior_plan_turn:
            return None
        missing_fields: list[str] = []
        if not slots.get("goal"):
            missing_fields.append("goal")
        if not slots.get("frequency") and not slots.get("focus"):
            missing_fields.append("frequency")
        return {
            **fallback,
            "intent": "plan_generate",
            "confidence": 0.88 if not missing_fields else 0.74,
            "referenced_context": ["recent_plan_generation_turn"],
            "missing_fields": missing_fields,
            "should_clarify": bool(missing_fields),
            "clarifying_question": "",
            "write_domain": "plan",
            "source": "contextual_plan_flow",
            "plan_slots": slots,
        }

    def _has_explicit_memory_request(self, text: str) -> bool:
        return self._contains_marker(text, self.MEMORY_EXPLICIT_MARKERS)

    def _has_safety_clarification_signal(self, text: str, intent: dict[str, Any]) -> bool:
        risk_flags = " ".join(self._string_list(intent.get("risk_flags"))).lower()
        return self._contains_marker(text, self.SAFETY_CLARIFY_MARKERS) or any(
            marker in risk_flags
            for marker in (
                "pain",
                "injury",
                "chest",
                "knee",
                "back",
                "extreme",
                "calorie",
                "疼",
                "痛",
                "伤",
                "胸",
                "膝",
                "腰",
            )
        )

    def _operation_label(self, intent_name: str, write_domain: str | None) -> str:
        labels = {
            "workout_plan": "生成训练计划",
            "meal_plan": "生成饮食计划",
            "plan_generate": "生成训练计划",
            "plan_adjust": "调整训练计划",
            "workout_log": "记录训练日志",
            "checkin_log": "记录今日状态",
            "body_metric_log": "记录身体指标",
            "diet_log": "记录饮食信息",
            "memory_save": "保存长期偏好",
        }
        domain_labels = {
            "plan": "整理训练计划操作",
            "meal_plan": "整理饮食计划操作",
            "workout_log": "记录训练日志",
            "daily_checkin": "记录今日状态",
            "body_metric": "记录身体指标",
            "diet_log": "记录饮食信息",
            "memory": "保存长期偏好",
        }
        return labels.get(intent_name) or domain_labels.get(str(write_domain or "")) or "处理这次操作"

    def _planner_without_write_tools(
        self,
        planner: dict[str, Any],
        *,
        action: str = "clarify",
        write_domain: str | None = None,
    ) -> dict[str, Any]:
        safe_tools = [
            {
                "name": str(tool.get("name") or ""),
                "arguments": self._sanitize_tool_arguments(str(tool.get("name") or ""), tool.get("arguments")),
                "purpose": str(tool.get("purpose") or ""),
            }
            for tool in list(planner.get("tools") or [])[:4]
            if str(tool.get("name") or "") in self.PLANNER_TOOL_WHITELIST
            and str(tool.get("name") or "") != "create_action_proposal"
        ]
        return {
            **planner,
            "action": action,
            "tools": safe_tools if action == "answer" else [],
            "requires_proposal": False,
            "write_domain": write_domain,
            "dialogue_mode": action,
        }

    def _planner_with_write_tool(self, planner: dict[str, Any], write_domain: str) -> dict[str, Any]:
        return self._normalize_planner_decision(
            {
                **planner,
                "action": "propose",
                "requires_proposal": True,
                "write_domain": write_domain,
                "tools": list(planner.get("tools") or []),
            },
            {
                **planner,
                "action": "propose",
                "requires_proposal": True,
                "write_domain": write_domain,
            },
        )

    def _operation_readiness(
        self,
        request: PostMessageRequest,
        conversation_context: dict[str, Any],
        intent: dict[str, Any],
        planner: dict[str, Any],
        write_domain: str,
    ) -> dict[str, Any]:
        text = request.text
        intent_name = str(intent.get("intent") or "")
        has_digit = self._has_digit(text)
        has_operation_marker = self._contains_marker(text, self.OPERATION_MARKERS)
        missing_fields = self._string_list(intent.get("missing_fields")) or self._string_list(planner.get("missing_fields"))

        def ready() -> dict[str, Any]:
            return {"ready": True, "mode": "propose", "question": "", "chips": []}

        def ask(question: str, chips: list[str], mode: str = "clarify") -> dict[str, Any]:
            return {"ready": False, "mode": mode, "question": question, "chips": chips[:3]}

        if intent_name in {"plan_generate", "workout_plan"} or (write_domain == "plan" and intent_name == "unclear"):
            slots = self._plan_generation_slots(text, conversation_context)
            has_goal = bool(slots.get("goal")) or self._contains_marker(text, self.PLAN_GOAL_MARKERS)
            has_frequency = bool(slots.get("frequency")) or self._contains_marker(text, self.PLAN_FREQUENCY_MARKERS) or bool(
                re.search(r"\d+\s*(天|次|day|days|x)", text, flags=re.IGNORECASE)
            ) or bool(slots.get("focus"))
            if "goal" in missing_fields or not has_goal:
                return ask("这份计划的目标更偏增肌、减脂还是力量提升？", ["增肌", "减脂", "提升力量"])
            if "frequency" in missing_fields or not has_frequency:
                return ask("这份计划按单次训练，还是一周几天来排？", ["今天一次", "一周3天", "一周4天"])
            return ready()

        if intent_name == "meal_plan" or write_domain == "meal_plan":
            has_goal = self._contains_marker(text, self.PLAN_GOAL_MARKERS) or any(
                marker in text for marker in ("控体重", "健康饮食", "维持", "减肥", "减重")
            )
            if "goal" in missing_fields or not has_goal:
                return ask("这份饮食计划的目标更偏减脂、增肌，还是维持健康饮食？", ["减脂", "增肌", "维持健康饮食"])
            if any(marker in text for marker in ("800卡", "极低热量", "不吃主食", "断食")):
                return ask("这个饮食目标风险偏高，我不能直接生成极端方案。你愿意改成温和热量缺口和高蛋白版本吗？", ["温和减脂", "先给原则建议", "我补充身体数据"])
            return ready()

        if intent_name == "plan_adjust":
            if self._is_delete_all_plan_request(text):
                return ready()
            has_target = bool(self._string_list(intent.get("referenced_context"))) or self._contains_marker(
                text,
                ("今天", "明天", "后天", "周一", "周二", "周三", "周四", "周五", "周六", "周日", "第", "刚才", "那个", "day"),
            )
            has_change = self._contains_marker(text, self.PLAN_ADJUSTMENT_MARKERS)
            if "target" in missing_fields or "target_day" in missing_fields or not has_target:
                return ask("你想调整哪一天或哪一项训练？", ["调整明天", "调整刚才那天", "把跑跳换掉"])
            if not has_change:
                return ask("你希望这项训练怎么改？", ["改轻一点", "换成不跑跳", "减少训练量"])
            return ready()

        if intent_name == "workout_log" or write_domain == "workout_log":
            has_detail = self._contains_marker(text, self.WORKOUT_DETAIL_MARKERS) or bool(
                re.search(r"\d+\s*(分钟|分|小时|组|次|min|mins|hour|hours)", text, flags=re.IGNORECASE)
            )
            if has_detail:
                return ready()
            question = "你是想让我把这次内容记成训练日志，还是先只是聊聊训练状态？"
            return ask(question, ["记成训练日志", "先聊聊状态", "我补充训练时长"], "confirm_operation" if has_operation_marker else "clarify")

        if intent_name == "body_metric_log" or write_domain == "body_metric":
            has_metric = self._contains_marker(text, self.BODY_METRIC_MARKERS)
            if has_metric and has_digit:
                return ready()
            if has_metric:
                return ask("今天要记录的具体数值是多少？", ["68kg", "补充体脂率", "先不记录"])
            return ask("这个数字对应哪个身体指标？", ["体重 kg", "腰围 cm", "体脂率 %"])

        if intent_name == "checkin_log" or write_domain == "daily_checkin":
            has_signal = self._contains_marker(text, self.CHECKIN_DETAIL_MARKERS) or bool(
                re.search(r"\d+\s*(小时|步|杯|分|h|hours|steps)", text, flags=re.IGNORECASE)
            )
            if has_signal:
                return ready()
            return ask("你想记录哪类今日状态？", ["睡眠和疲劳", "步数和饮水", "疼痛或不适"])

        if intent_name == "diet_log" or write_domain == "diet_log":
            has_diet_detail = self._contains_marker(text, self.DIET_DETAIL_MARKERS) or has_digit
            if has_diet_detail:
                return ready()
            return ask("这条饮食记录里，先补哪个关键信息？", ["吃了什么", "大概热量", "是哪一餐"])

        if intent_name == "memory_save" or write_domain == "memory":
            if self._has_explicit_memory_request(text):
                return ready()
            return ask("这条偏好要我长期记住吗？", ["记住这个偏好", "先不用记", "我再说具体一点"], "confirm_operation")

        return ready()

    def _decide_dialogue_turn(
        self,
        request: PostMessageRequest,
        conversation_context: dict[str, Any],
        intent: dict[str, Any],
        planner: dict[str, Any],
    ) -> dict[str, Any]:
        intent_name = str(intent.get("intent") or "")
        planner_action = str(planner.get("action") or "answer")
        write_domain = self._normalize_write_domain(
            planner.get("write_domain") or intent.get("write_domain"),
            intent=intent_name,
            fallback=self.WRITE_INTENT_TO_DOMAIN.get(intent_name),
        )
        label = self._operation_label(intent_name, write_domain)
        base_decision = {
            "mode": planner_action,
            "operation_label": label,
            "question": "",
            "chips": [],
            "intent": intent,
            "planner": planner,
            "source": "dialogue_policy",
        }

        if planner_action == "legacy_route":
            return {**base_decision, "mode": "legacy_route"}

        if intent_name == "memory_save" and write_domain == "memory" and not self._has_explicit_memory_request(request.text):
            answer_planner = self._planner_without_write_tools(planner, action="answer", write_domain=None)
            if not answer_planner["tools"]:
                answer_planner["tools"] = [
                    {"name": "get_memory_summary", "arguments": {}, "purpose": "Read existing coaching memories."}
                ]
            return {
                **base_decision,
                "mode": "answer",
                "intent": {**intent, "write_domain": None},
                "planner": {**answer_planner, "dialogue_mode": "answer", "implicit_memory_candidate": True},
            }

        if write_domain and write_domain in {"plan", "meal_plan", "workout_log", "diet_log"} and self._has_safety_clarification_signal(request.text, intent):
            question = "先确认安全边界：这个疼痛或不适现在是什么位置、程度和持续时间？"
            safe_planner = self._planner_without_write_tools(planner, action="clarify", write_domain=write_domain)
            return {
                **base_decision,
                "mode": "clarify",
                "question": question,
                "chips": ["疼痛0-10分", "什么时候开始的", "先换低冲击训练"],
                "planner": {**safe_planner, "dialogue_mode": "clarify", "dialogue_reason": "safety_first"},
            }

        if write_domain == "plan" and intent_name in {"plan_generate", "workout_plan", "unclear"}:
            readiness = self._operation_readiness(request, conversation_context, intent, planner, write_domain)
            if not readiness["ready"]:
                safe_planner = self._planner_without_write_tools(planner, action="clarify", write_domain=write_domain)
                return {
                    **base_decision,
                    "mode": readiness["mode"],
                    "question": readiness["question"],
                    "chips": readiness["chips"],
                    "planner": {
                        **safe_planner,
                        "dialogue_mode": readiness["mode"],
                        "dialogue_reason": "operation_not_ready",
                    },
                }
            if self._coerce_bool(intent.get("should_clarify")) or planner_action == "clarify":
                proposal_planner = self._planner_with_write_tool(
                    {
                        **planner,
                        "action": "propose",
                        "requires_proposal": True,
                        "write_domain": write_domain,
                    },
                    write_domain,
                )
                return {
                    **base_decision,
                    "mode": "propose",
                    "planner": {**proposal_planner, "dialogue_mode": "propose", "dialogue_reason": "plan_context_ready"},
                }

        if write_domain and write_domain != "plan" and (
            self._coerce_bool(intent.get("should_clarify")) or planner_action == "clarify"
        ):
            readiness = self._operation_readiness(request, conversation_context, intent, planner, write_domain)
            if not readiness["ready"]:
                safe_planner = self._planner_without_write_tools(planner, action="clarify", write_domain=write_domain)
                return {
                    **base_decision,
                    "mode": readiness["mode"],
                    "question": readiness["question"],
                    "chips": readiness["chips"],
                    "planner": {
                        **safe_planner,
                        "dialogue_mode": readiness["mode"],
                        "dialogue_reason": "operation_not_ready",
                    },
                }
            proposal_planner = self._planner_with_write_tool(
                {
                    **planner,
                    "action": "propose",
                    "requires_proposal": True,
                    "write_domain": write_domain,
                },
                write_domain,
            )
            return {
                **base_decision,
                "mode": "propose",
                "planner": {**proposal_planner, "dialogue_mode": "propose", "dialogue_reason": "operation_context_ready"},
            }

        if self._coerce_bool(intent.get("should_clarify")) or planner_action == "clarify":
            question = str(intent.get("clarifying_question") or "").strip()
            if not question:
                question = "我先确认一下，你更想让我给建议、记录数据，还是整理一个待确认操作？"
            safe_planner = self._planner_without_write_tools(planner, action="clarify", write_domain=write_domain)
            return {
                **base_decision,
                "mode": "clarify",
                "question": question,
                "chips": ["先给建议", "帮我记录", "整理成待确认卡片"],
                "planner": {**safe_planner, "dialogue_mode": "clarify"},
            }

        if write_domain and (planner_action == "propose" or self._coerce_bool(planner.get("requires_proposal"))):
            readiness = self._operation_readiness(request, conversation_context, intent, planner, write_domain)
            if not readiness["ready"]:
                safe_planner = self._planner_without_write_tools(planner, action="clarify", write_domain=write_domain)
                return {
                    **base_decision,
                    "mode": readiness["mode"],
                    "question": readiness["question"],
                    "chips": readiness["chips"],
                    "planner": {
                        **safe_planner,
                        "dialogue_mode": readiness["mode"],
                        "dialogue_reason": "operation_not_ready",
                    },
                }
            proposal_planner = self._planner_with_write_tool(planner, write_domain)
            return {
                **base_decision,
                "mode": "propose",
                "planner": {**proposal_planner, "dialogue_mode": "propose"},
            }

        return {**base_decision, "mode": "answer", "planner": {**planner, "dialogue_mode": "answer"}}

    async def _load_conversation_context(
        self,
        thread_id: str,
        current_message: str,
        authorization: str | None,
    ) -> dict[str, Any]:
        async def read_messages() -> list[dict[str, Any]]:
            try:
                return await self.store.list_messages(thread_id, authorization)
            except Exception as exc:
                logger.warning("Unable to load thread messages for intent context: %s", exc)
                return []

        async def read_thread_summary() -> str:
            try:
                thread = await self.store.get_thread(thread_id, authorization)
                return str(thread.get("summary") or "")
            except Exception as exc:
                logger.warning("Unable to load thread summary for intent context: %s", exc)
                return ""

        async def read_memory_summary() -> dict[str, Any]:
            try:
                memory = await self.tools.get_memory_summary(authorization=authorization)
                return memory.data if memory.ok else {}
            except Exception as exc:
                logger.warning("Unable to load memory summary for intent context: %s", exc)
                return {}

        messages, thread_summary, memory_summary = await asyncio.gather(
            read_messages(),
            read_thread_summary(),
            read_memory_summary(),
        )

        recent_messages = self._select_recent_messages_for_context(messages)
        older_messages = messages[: max(0, len(messages) - len(recent_messages))]
        thread_summary = await self._refresh_thread_summary_if_needed(
            thread_id,
            thread_summary,
            older_messages,
            authorization,
        )

        return {
            "current_message": current_message,
            "recent_messages": recent_messages,
            "thread_summary": thread_summary,
            "memory_summary": memory_summary,
            "context_window": {
                "strategy": "thread_summary_plus_budgeted_recent_messages",
                "total_message_count": len(messages),
                "recent_message_count": len(recent_messages),
                "summarized_message_count": len(older_messages),
                "recent_char_budget": self.CONTEXT_TOTAL_CHAR_BUDGET,
                "message_char_limit": self.CONTEXT_MESSAGE_CHAR_LIMIT,
            },
        }

    @classmethod
    def _trim_context_text(cls, text: Any, limit: int) -> str:
        normalized = re.sub(r"\s+", " ", str(text or "")).strip()
        if len(normalized) <= limit:
            return normalized
        return f"{normalized[: max(0, limit - 3)]}..."

    @classmethod
    def _message_context_item(cls, message: dict[str, Any], char_limit: int | None = None) -> dict[str, Any]:
        return {
            "role": str(message.get("role") or ""),
            "content": cls._trim_context_text(message.get("content"), char_limit or cls.CONTEXT_MESSAGE_CHAR_LIMIT),
            "created_at": message.get("created_at"),
        }

    @classmethod
    def _select_recent_messages_for_context(cls, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        selected: list[dict[str, Any]] = []
        total_chars = 0

        for message in reversed(messages):
            item = cls._message_context_item(message)
            message_cost = len(item["role"]) + len(item["content"]) + 32
            if selected and (
                len(selected) >= cls.CONTEXT_RECENT_MESSAGE_LIMIT
                or total_chars + message_cost > cls.CONTEXT_TOTAL_CHAR_BUDGET
            ):
                break
            selected.append(item)
            total_chars += message_cost

        return list(reversed(selected))

    @classmethod
    def _summary_source_messages(cls, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        selected: list[dict[str, Any]] = []
        total_chars = 0

        for message in reversed(messages):
            item = cls._message_context_item(message, 700)
            message_cost = len(item["role"]) + len(item["content"]) + 32
            if selected and total_chars + message_cost > cls.SUMMARY_SOURCE_CHAR_BUDGET:
                break
            selected.append(item)
            total_chars += message_cost

        return list(reversed(selected))

    def _fallback_thread_summary(self, existing_summary: str, older_messages: list[dict[str, Any]]) -> str:
        snippets = [
            f"{message['role']}: {message['content']}"
            for message in self._summary_source_messages(older_messages)[-8:]
            if message.get("content")
        ]
        parts = []
        if existing_summary.strip():
            parts.append(self._trim_context_text(existing_summary, 700))
        if snippets:
            parts.append("Earlier turns: " + " | ".join(snippets))
        return self._trim_context_text("\n".join(parts), self.THREAD_SUMMARY_CHAR_LIMIT)

    async def _build_thread_summary(self, existing_summary: str, older_messages: list[dict[str, Any]]) -> str:
        fallback_summary = self._fallback_thread_summary(existing_summary, older_messages)
        if not self.llm.is_enabled():
            return fallback_summary

        system_prompt = (
            "You maintain compact per-chat context for GymPal, a fitness coaching chat app. "
            "Return JSON only with key summary. Summarize only this one thread. "
            "Preserve durable user goals, constraints, preferences, decisions, unresolved questions, and pending plans. "
            "Drop greetings, repetition, and transient wording. Keep summary under 900 characters."
        )
        user_prompt = json.dumps(
            {
                "existing_summary": existing_summary,
                "older_messages_to_fold_in": self._summary_source_messages(older_messages),
                "fallback_summary": fallback_summary,
            },
            ensure_ascii=False,
        )
        result = await asyncio.to_thread(self.llm.generate_structured_with_metadata, system_prompt, user_prompt)
        if not result.ok:
            logger.warning("Thread summary compression failed: %s", result.error_code)
            return fallback_summary

        summary = self._trim_context_text(result.data.get("summary"), self.THREAD_SUMMARY_CHAR_LIMIT)
        return summary or fallback_summary

    async def _refresh_thread_summary_if_needed(
        self,
        thread_id: str,
        existing_summary: str,
        older_messages: list[dict[str, Any]],
        authorization: str | None,
    ) -> str:
        if len(older_messages) < self.SUMMARY_MIN_OLDER_MESSAGES:
            return existing_summary

        summary = await self._build_thread_summary(existing_summary, older_messages)
        if not summary or summary.strip() == existing_summary.strip():
            return existing_summary

        try:
            await self.store.update_thread(thread_id, summary=summary, authorization=authorization)
        except Exception as exc:
            logger.warning("Unable to persist thread summary: %s", exc)
            return existing_summary

        return summary

    async def _classify_intent(
        self,
        request: PostMessageRequest,
        conversation_context: dict[str, Any],
    ) -> tuple[dict[str, Any], StructuredLLMResult | None, str | None]:
        fallback = self._fallback_intent_from_keywords(request.text)
        modern_intent = self._modern_intent_from_keywords(request.text, fallback, conversation_context)
        if modern_intent is not None:
            return modern_intent, None, None
        contextual_intent = self._contextual_plan_intent(request, conversation_context, fallback)
        if contextual_intent is not None:
            return contextual_intent, None, None
        if not self.llm.is_enabled():
            return fallback, None, "llm_disabled"
        if self._is_obvious_read_only_request(request.text, fallback):
            return {
                **fallback,
                "confidence": max(float(fallback.get("confidence") or 0.0), 0.82),
                "agent_intent": "exercise_instruction" if fallback.get("intent") == "exercise_search" else "direct_answer",
                "write_domain": None,
                "should_clarify": False,
                "missing_fields": [],
                "clarifying_question": "",
                "source": "keyword_read_fast_path",
            }, None, None

        system_prompt = (
            "You classify user intent for a fitness coaching agent. Return JSON only. "
            "Do not answer the user. Use the provided conversation context to resolve follow-ups. "
            "Default to direct_answer, fitness_knowledge, exercise_instruction, nutrition_advice, or safety_sensitive for ordinary questions. "
            "Only classify workout_plan/plan_generate or meal_plan when the user explicitly asks you to create, build, arrange, schedule, or plan a training or diet program. "
            "Do not treat general advice questions as plan requests. "
            "Allowed intent values: health_answer, plan_answer, plan_generate, plan_adjust, workout_log, "
            "checkin_log, body_metric_log, diet_log, memory_save, weekly_review, daily_guidance, "
            "exercise_search, location_search, direct_answer, fitness_knowledge, exercise_instruction, "
            "nutrition_advice, workout_plan, meal_plan, user_data_query, clarification_needed, safety_sensitive, out_of_scope, unclear. "
            "Return keys: intent, confidence, referenced_context, missing_fields, risk_flags, "
            "should_clarify, clarifying_question, write_domain, agent_intent."
        )
        user_prompt = json.dumps(
            {
                "message": request.text,
                "location_hint": request.location_hint,
                "latitude": request.latitude,
                "longitude": request.longitude,
                "conversation_context": conversation_context,
                "fallback_hint": fallback,
            },
            ensure_ascii=False,
        )
        result = await asyncio.to_thread(self.llm.generate_structured_with_metadata, system_prompt, user_prompt)
        if not result.ok:
            return fallback, result, result.error_code or "llm_classifier_failed"
        normalized = self._normalize_intent_result(result.data, fallback)
        normalized_intent = str(normalized.get("intent") or "")
        normalized_domain = str(normalized.get("write_domain") or "")
        if (
            normalized_intent in {"plan_generate", "workout_plan"}
            or (normalized_domain == "plan" and normalized_intent not in {"plan_adjust", "unclear"})
        ) and not self._is_strong_keyword_write_intent(request.text, fallback) and not (
            self._is_explicit_workout_plan_request(request.text)
            or self._is_plan_generation_request(request.text)
        ):
            guarded_fallback = {**fallback, "write_domain": None}
            guarded = self._modern_intent_from_keywords(request.text, guarded_fallback, conversation_context) or {
                **guarded_fallback,
                "intent": "health_answer",
                "agent_intent": "direct_answer",
                "confidence": max(float(fallback.get("confidence") or 0.0), 0.78),
                "should_clarify": False,
                "missing_fields": [],
                "clarifying_question": "",
                "source": "plan_write_guard",
            }
            return {
                **guarded,
                "write_domain": None,
                "source": "plan_write_guard",
                "overrode_llm_intent": {
                    "intent": normalized_intent,
                    "write_domain": normalized_domain or None,
                    "confidence": normalized.get("confidence"),
                },
            }, result, None
        if self._is_exercise_recommendation_request(request.text) and (
            normalized_intent != "exercise_search"
            or bool(normalized.get("write_domain"))
            or self._coerce_bool(normalized.get("should_clarify"))
        ):
            return {
                **fallback,
                "intent": "exercise_search",
                "confidence": max(float(fallback.get("confidence") or 0.0), 0.82),
                "write_domain": None,
                "should_clarify": False,
                "missing_fields": [],
                "clarifying_question": "",
                "source": "keyword_read_override",
                "overrode_llm_intent": {
                    "intent": normalized.get("intent"),
                    "write_domain": normalized.get("write_domain"),
                    "confidence": normalized.get("confidence"),
                },
            }, result, None
        if self._is_strong_keyword_write_intent(request.text, fallback):
            fallback_domain = str(fallback.get("write_domain") or "")
            fallback_intent = str(fallback.get("intent") or "")
            if normalized_domain != fallback_domain or (
                fallback_intent == "plan_adjust" and normalized_intent == "plan_generate"
            ):
                return {
                    **fallback,
                    "source": "keyword_override",
                    "overrode_llm_intent": {
                        "intent": normalized_intent,
                        "write_domain": normalized_domain or None,
                        "confidence": normalized.get("confidence"),
                    },
                }, result, None
        return normalized, result, None

    def _fallback_planner_from_intent(self, intent: dict[str, Any], request: PostMessageRequest) -> dict[str, Any]:
        intent_name = str(intent.get("intent") or "health_answer")
        agent_intent = str(intent.get("agent_intent") or "")
        write_domain = self._normalize_write_domain(
            intent.get("write_domain"),
            intent=intent_name,
            fallback=self.WRITE_INTENT_TO_DOMAIN.get(intent_name),
        )
        guarded_plan_write = False
        if (
            write_domain == "plan"
            and intent_name in {"plan_generate", "workout_plan"}
            and str(intent.get("source") or "") != "contextual_plan_flow"
            and not self._is_explicit_workout_plan_request(request.text)
            and not self._is_plan_generation_request(request.text)
        ):
            write_domain = None
            intent_name = "health_answer"
            agent_intent = agent_intent or "direct_answer"
            guarded_plan_write = True
        tools: list[dict[str, Any]] = []
        action = "answer"
        risk_level = "medium" if intent_name.startswith("plan") or write_domain in {"plan", "meal_plan"} else "low"
        if agent_intent == "safety_sensitive" or self._has_safety_clarification_signal(request.text, intent):
            risk_level = "high"

        if intent_name in {"weekly_review", "daily_guidance"}:
            action = "legacy_route"
        elif write_domain:
            action = "propose"
            if write_domain == "plan" and intent_name in {"plan_generate", "workout_plan"}:
                tools.extend(
                    [
                        {"name": "get_coach_summary", "arguments": {}, "purpose": "Read recent coaching context."},
                        {"name": "get_exercise_catalog", "arguments": {}, "purpose": "Read exercise options."},
                    ]
                )
            elif write_domain == "meal_plan":
                tools.append({"name": "get_memory_summary", "arguments": {}, "purpose": "Read nutrition preferences and constraints."})
            tools.append(
                {
                    "name": "create_action_proposal",
                    "arguments": {"write_domain": write_domain},
                    "purpose": "Generate safe pending proposals instead of writing directly.",
                }
            )
        elif intent_name == "plan_answer":
            tools.extend(
                [
                    {"name": "load_current_plan", "arguments": {}, "purpose": "Read the current active plan."},
                    {"name": "get_memory_summary", "arguments": {}, "purpose": "Read relevant coaching preferences."},
                ]
            )
            risk_level = "medium"
        elif agent_intent == "user_data_query":
            tools.extend(
                [
                    {"name": "get_coach_summary", "arguments": {}, "purpose": "Read recent training, recovery, and nutrition context."},
                    {"name": "get_memory_summary", "arguments": {}, "purpose": "Read relevant coaching preferences."},
                ]
            )
            risk_level = "medium"
        elif intent_name == "exercise_search":
            tools.append({"name": "get_exercise_catalog", "arguments": {}, "purpose": "Read exercise catalog."})
        elif intent_name == "location_search":
            if request.latitude is not None and request.longitude is not None:
                tools.append(
                    {
                        "name": "search_nearby_places",
                        "arguments": {
                            "keyword": "gym",
                            "latitude": request.latitude,
                            "longitude": request.longitude,
                            "location_hint": request.location_hint,
                        },
                        "purpose": "Search nearby training places.",
                    }
                )
            elif request.location_hint:
                tools.append({"name": "geocode_location", "arguments": {"location": request.location_hint}, "purpose": "Resolve location."})

        if write_domain and self._has_safety_clarification_signal(request.text, intent):
            action = "clarify"
            tools = []
            risk_level = "high"

        if self._coerce_bool(intent.get("should_clarify")) and not write_domain:
            action = "clarify"
            tools = []
            risk_level = "high" if agent_intent == "safety_sensitive" else risk_level

        return {
            "action": action,
            "tools": tools[:4],
            "requires_proposal": bool(write_domain) and action == "propose",
            "write_domain": write_domain,
            "response_style": "normal",
            "missing_fields": intent.get("missing_fields") or [],
            "risk_level": risk_level,
            "source": "plan_write_guard" if guarded_plan_write else "fallback_planner",
        }

    def _normalize_planner_decision(self, raw: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
        action = str(raw.get("action") or fallback.get("action") or "answer")
        if action not in {"answer", "clarify", "propose", "legacy_route"}:
            action = str(fallback.get("action") or "answer")

        tools: list[dict[str, Any]] = []
        raw_tools = raw.get("tools")
        raw_tools_present = isinstance(raw_tools, list)
        if isinstance(raw_tools, list):
            for raw_tool in raw_tools:
                if not isinstance(raw_tool, dict):
                    continue
                name = str(raw_tool.get("name") or "").strip()
                if name not in self.PLANNER_TOOL_WHITELIST:
                    continue
                arguments = raw_tool.get("arguments")
                tools.append(
                    {
                        "name": name,
                        "arguments": self._sanitize_tool_arguments(name, arguments),
                        "purpose": str(raw_tool.get("purpose") or ""),
                    }
                )
                if len(tools) >= 4:
                    break

        write_domain = self._normalize_write_domain(raw.get("write_domain"), fallback=fallback.get("write_domain"))
        requires_proposal = False
        if action == "clarify":
            tools = []
            write_domain = self._normalize_write_domain(raw.get("write_domain"), fallback=fallback.get("write_domain"))
        elif not raw_tools_present and not tools:
            tools = list(fallback.get("tools") or [])[:4]
            tools = [
                {
                    "name": str(tool.get("name") or ""),
                    "arguments": self._sanitize_tool_arguments(str(tool.get("name") or ""), tool.get("arguments")),
                    "purpose": str(tool.get("purpose") or ""),
                }
                for tool in tools
                if str(tool.get("name") or "") in self.PLANNER_TOOL_WHITELIST
            ]

        if action != "clarify":
            requires_proposal = self._coerce_bool(raw.get("requires_proposal")) or action == "propose" or bool(fallback.get("requires_proposal"))
            if write_domain and requires_proposal:
                create_tool_index = next(
                    (index for index, tool in enumerate(tools) if str(tool.get("name") or "") == "create_action_proposal"),
                    None,
                )
                if create_tool_index is None:
                    tools = tools[:3]
                    tools.append(
                        {
                            "name": "create_action_proposal",
                            "arguments": {"write_domain": write_domain},
                            "purpose": "Generate safe pending proposals instead of writing directly.",
                        }
                    )
                else:
                    tools[create_tool_index]["arguments"] = {
                        **self._sanitize_tool_arguments("create_action_proposal", tools[create_tool_index].get("arguments")),
                        "write_domain": write_domain,
                    }
        return {
            "action": action,
            "tools": tools,
            "requires_proposal": requires_proposal,
            "write_domain": str(write_domain) if write_domain else None,
            "response_style": str(raw.get("response_style") or fallback.get("response_style") or "normal"),
            "missing_fields": self._string_list(raw.get("missing_fields")) or list(fallback.get("missing_fields") or []),
            "risk_level": str(raw.get("risk_level") or fallback.get("risk_level") or "medium"),
            "source": "llm_planner",
        }

    async def _plan_next_steps(
        self,
        request: PostMessageRequest,
        conversation_context: dict[str, Any],
        intent: dict[str, Any],
        degraded_reason: str | None,
    ) -> tuple[dict[str, Any], StructuredLLMResult | None, str | None]:
        fallback = self._fallback_planner_from_intent(intent, request)
        if degraded_reason or not self.llm.is_enabled():
            return fallback, None, degraded_reason or "llm_disabled"
        if intent.get("source") in {"contextual_plan_flow", "keyword_read_fast_path", "modern_intent_router", "modern_context_route"}:
            return fallback, None, None

        system_prompt = (
            "You are the planner for a safe fitness coaching agent. Return JSON only and do not answer the user. "
            "Choose from actions: answer, clarify, propose, legacy_route. "
            "Default to answer for direct_answer, fitness_knowledge, exercise_instruction, nutrition_advice, safety_sensitive, and out_of_scope. "
            "Use propose only when write_domain is present from an explicit write or explicit plan request. "
            "Allowed tools: get_coach_summary, load_current_plan, get_memory_summary, get_workspace_summary, "
            "get_exercise_catalog, get_recovery_guidance, geocode_location, reverse_geocode, search_nearby_places, "
            "create_action_proposal. "
            "Never write database state directly. For writes, use create_action_proposal only. "
            "Return keys: action, tools, requires_proposal, write_domain, response_style, missing_fields, risk_level."
        )
        user_prompt = json.dumps(
            {
                "message": request.text,
                "intent": intent,
                "conversation_context": conversation_context,
                "fallback_plan": fallback,
                "location": {"hint": request.location_hint, "latitude": request.latitude, "longitude": request.longitude},
            },
            ensure_ascii=False,
        )
        result = await asyncio.to_thread(self.llm.generate_structured_with_metadata, system_prompt, user_prompt)
        if not result.ok:
            return fallback, result, result.error_code or "llm_planner_failed"
        normalized = self._normalize_planner_decision(result.data, fallback)
        keyword_fallback = self._fallback_intent_from_keywords(request.text)
        has_write_tool = any(str(tool.get("name") or "") == "create_action_proposal" for tool in normalized.get("tools") or [])
        read_only_agent_intents = {
            "direct_answer",
            "fitness_knowledge",
            "exercise_instruction",
            "nutrition_advice",
            "safety_sensitive",
            "out_of_scope",
        }
        if str(intent.get("agent_intent") or intent.get("intent") or "") in read_only_agent_intents and (
            bool(normalized.get("write_domain"))
            or self._coerce_bool(normalized.get("requires_proposal"))
            or has_write_tool
            or str(normalized.get("action") or "") == "propose"
        ):
            return {
                **fallback,
                "action": "answer" if not self._coerce_bool(intent.get("should_clarify")) else "clarify",
                "tools": [],
                "requires_proposal": False,
                "write_domain": None,
                "source": "read_only_planner_override",
                "overrode_llm_planner": {
                    "action": normalized.get("action"),
                    "write_domain": normalized.get("write_domain"),
                    "missing_fields": normalized.get("missing_fields") or [],
                },
            }, result, None
        if self._is_exercise_recommendation_request(request.text) and (
            str(normalized.get("action") or "") != "answer"
            or bool(normalized.get("write_domain"))
            or self._coerce_bool(normalized.get("requires_proposal"))
            or has_write_tool
        ):
            return {
                "action": "answer",
                "tools": [{"name": "get_exercise_catalog", "arguments": {}, "purpose": "Read exercise catalog."}],
                "requires_proposal": False,
                "write_domain": None,
                "response_style": str(fallback.get("response_style") or "normal"),
                "missing_fields": [],
                "risk_level": "low",
                "source": "keyword_read_planner_override",
                "overrode_llm_planner": {
                    "action": normalized.get("action"),
                    "write_domain": normalized.get("write_domain"),
                    "missing_fields": normalized.get("missing_fields") or [],
                },
            }, result, None
        if self._is_strong_keyword_write_intent(request.text, keyword_fallback):
            fallback_domain = str(fallback.get("write_domain") or "")
            normalized_domain = str(normalized.get("write_domain") or "")
            if fallback_domain and (normalized_domain != fallback_domain or normalized.get("action") == "clarify"):
                return {
                    **fallback,
                    "source": "keyword_planner_override",
                    "overrode_llm_planner": {
                        "action": normalized.get("action"),
                        "write_domain": normalized_domain or None,
                        "missing_fields": normalized.get("missing_fields") or [],
                    },
                }, result, None
        return normalized, result, None

    def _build_tool_activity_card(
        self,
        tool_events: list[ToolEvent],
        degraded_reason: str | None = None,
    ) -> Card | None:
        completed = [event for event in tool_events if event.event == "tool_call_completed"]
        if not completed and not degraded_reason:
            return None
        bullets = []
        for event in completed[:5]:
            ok = event.payload.get("ok")
            status = "完成" if ok is not False else "失败"
            bullets.append(f"{event.tool_name}: {status} - {event.summary}")
        if degraded_reason:
            bullets.insert(0, f"受限模式: {degraded_reason}")
        return Card(
            type="tool_activity_card",
            title="Agent 工作过程",
            description="这次回复使用了以下上下文读取、规划或降级信息。",
            bullets=bullets[:6] or ["本轮没有调用外部工具。"],
            data={
                "degradedReason": degraded_reason,
                "toolEvents": [event.model_dump(mode="json") for event in completed],
            },
        )

    async def _persist_tool_events(
        self,
        thread_id: str,
        run_id: str,
        tool_events: list[ToolEvent],
        authorization: str | None,
        planner_step: str,
    ) -> None:
        for event in tool_events:
            if event.event != "tool_call_completed":
                continue
            try:
                await self.store.create_tool_invocation(
                    tool_name=event.tool_name,
                    status="completed" if event.payload.get("ok") is not False else "failed",
                    request_data={
                        "thread_id": thread_id,
                        "run_id": run_id,
                        "planner_step": event.payload.get("planner_step", planner_step),
                        "tool_name": event.tool_name,
                    },
                    response_data=event.payload,
                    authorization=authorization,
                )
            except Exception as exc:
                logger.warning("Unable to persist tool invocation log for %s: %s", event.tool_name, exc)

    async def _execute_planner_tools(
        self,
        thread_id: str,
        run_id: str,
        request: PostMessageRequest,
        planner: dict[str, Any],
        authorization: str | None,
        conversation_context: dict[str, Any] | None = None,
    ) -> tuple[list[dict[str, Any]], list[ToolEvent], list[dict[str, Any]], list[str]]:
        observations: list[dict[str, Any]] = []
        tool_events: list[ToolEvent] = []
        proposal_drafts: list[dict[str, Any]] = []
        validation_warnings: list[str] = []
        auth_tools = {"get_coach_summary", "load_current_plan", "get_memory_summary", "get_workspace_summary"}

        pending_tools = list(planner.get("tools") or [])[:4]
        for iteration in range(2):
            next_round_tools: list[dict[str, Any]] = []
            for index, tool in enumerate(pending_tools[:4]):
                name = str(tool.get("name") or "")
                if name not in self.PLANNER_TOOL_WHITELIST:
                    continue
                arguments = self._sanitize_tool_arguments(name, tool.get("arguments"))
                purpose = str(tool.get("purpose") or "")
                planner_step = f"{iteration}:{index}"
                tool_events.append(ToolEvent(event="tool_call_started", tool_name=name, summary=purpose or f"调用 {name}"))

                if name == "create_action_proposal":
                    write_domain = self._normalize_write_domain(arguments.get("write_domain"), fallback=planner.get("write_domain")) or ""
                    context, write_events = await self._load_write_context(write_domain, authorization)
                    if conversation_context is not None:
                        context["conversation_context"] = conversation_context
                    tool_events.extend(write_events)
                    proposed = self._heuristic_write_proposals(write_domain, request.text, context)
                    proposal_drafts, validation_warnings = self._validate_proposals(proposed)
                    payload = {
                        "ok": bool(proposal_drafts),
                        "proposal_count": len(proposal_drafts),
                        "validation_warnings": validation_warnings,
                        "planner_step": planner_step,
                    }
                    tool_events.append(
                        ToolEvent(
                            event="tool_call_completed",
                            tool_name=name,
                            summary=f"生成 {len(proposal_drafts)} 条待确认提案" if proposal_drafts else "未能生成安全提案",
                            payload=payload,
                        )
                    )
                    observations.append({"tool": name, "purpose": purpose, "result": payload})
                    continue

                kwargs = dict(arguments)
                if name in auth_tools:
                    kwargs["authorization"] = authorization
                if name == "search_nearby_places":
                    kwargs.setdefault("latitude", request.latitude)
                    kwargs.setdefault("longitude", request.longitude)
                    kwargs.setdefault("location_hint", request.location_hint)
                if name == "geocode_location" and not kwargs.get("location") and request.location_hint:
                    kwargs["location"] = request.location_hint

                try:
                    response = await self.tools.invoke(name, **kwargs)
                    payload = self._tool_payload(response)
                    payload["planner_step"] = planner_step
                    tool_events.append(
                        ToolEvent(
                            event="tool_call_completed",
                            tool_name=name,
                            summary=response.human_readable,
                            payload=payload,
                        )
                    )
                    observations.append(
                        {
                            "tool": name,
                            "purpose": purpose,
                            "ok": response.ok,
                            "source": response.source,
                            "data": response.data,
                            "error_code": response.error_code,
                            "planner_step": planner_step,
                        }
                    )
                    if (
                        iteration == 0
                        and name == "geocode_location"
                        and response.ok
                        and "latitude" in response.data
                        and "longitude" in response.data
                        and not any(str(item.get("name") or "") == "search_nearby_places" for item in pending_tools)
                    ):
                        next_round_tools.append(
                            {
                                "name": "search_nearby_places",
                                "arguments": {
                                    "keyword": arguments.get("keyword") or "gym",
                                    "latitude": response.data.get("latitude"),
                                    "longitude": response.data.get("longitude"),
                                    "location_hint": request.location_hint or arguments.get("location"),
                                },
                                "purpose": "Use resolved coordinates to search nearby training places.",
                            }
                        )
                except Exception as exc:
                    payload = {"ok": False, "error_code": "tool_exception", "error": str(exc), "planner_step": planner_step}
                    tool_events.append(
                        ToolEvent(
                            event="tool_call_completed",
                            tool_name=name,
                            summary=f"{name} 调用失败",
                            payload=payload,
                        )
                    )
                    observations.append(
                        {
                            "tool": name,
                            "purpose": purpose,
                            "ok": False,
                            "error_code": "tool_exception",
                            "error": str(exc),
                            "planner_step": planner_step,
                        }
                    )
            if not next_round_tools:
                break
            pending_tools = next_round_tools[:4]

        await self._persist_tool_events(thread_id, run_id, tool_events, authorization, "planner_loop")
        return observations, tool_events, proposal_drafts, validation_warnings

    def _card_type_for_intent(self, intent: str) -> str:
        if intent.startswith("plan") or intent in {"workout_plan", "meal_plan"}:
            return "workout_plan_card"
        if intent in {"exercise_search", "exercise_instruction"}:
            return "exercise_card"
        if intent == "location_search":
            return "place_result_card"
        if intent in {"daily_guidance", "weekly_review"}:
            return "daily_guidance_card" if intent == "daily_guidance" else "weekly_review_card"
        return "health_advice_card"

    async def _compose_planned_response(
        self,
        request: PostMessageRequest,
        conversation_context: dict[str, Any],
        intent: dict[str, Any],
        planner: dict[str, Any],
        observations: list[dict[str, Any]],
        degraded_reason: str | None,
    ) -> tuple[str, str, list[str], Card | None, StructuredLLMResult | None, str | None]:
        fallback_next_actions = ["告诉我目标或限制", "补充今天状态", "需要记录时先说一声"]
        fallback_content = "我在。你可以把我当训练搭子来聊：想问训练、恢复、动作选择都可以；如果你要我记录或调整什么，我会先确认再整理成待确认卡片。"
        fallback_reasoning = "本轮按普通训练对话处理，先结合可用上下文给建议；只有明确写操作时才进入待确认提案。"
        if degraded_reason or not self.llm.is_enabled():
            return fallback_content, fallback_reasoning, fallback_next_actions, None, None, degraded_reason or "llm_disabled"

        system_prompt = (
            "You are GymPal, a training buddy and non-medical fitness coach. "
            f"Reply in {self._detect_reply_language(request.text)}. "
            "Return JSON only with keys: content, reasoning_summary, next_actions, card_title, card_description, card_bullets. "
            "Be concise but complete: normal answers should be 2-4 short paragraphs; use more detail when the user asks for planning or explanation. "
            "Sound warm, direct, and conversational. Stay grounded in tool observations and do not claim that data was written. "
            "Do not expose internal reasoning, trace labels, LLM/planner/tool names, or process headings in content."
        )
        user_prompt = json.dumps(
            {
                "message": request.text,
                "conversation_context": conversation_context,
                "intent": intent,
                "planner": planner,
                "tool_observations": observations,
                "response_style": planner.get("response_style") or "normal",
                "fallback": {
                    "content": fallback_content,
                    "reasoning_summary": fallback_reasoning,
                    "next_actions": fallback_next_actions,
                },
            },
            ensure_ascii=False,
        )
        result = await asyncio.to_thread(self.llm.generate_structured_with_metadata, system_prompt, user_prompt)
        if not result.ok:
            return fallback_content, fallback_reasoning, fallback_next_actions, None, result, result.error_code or "llm_composer_failed"

        data = result.data
        card = Card(
            type=self._card_type_for_intent(str(intent.get("intent") or "")),
            title=str(data.get("card_title") or "基于当前上下文的建议"),
            description=str(data.get("card_description") or "这次回复基于当前对话、用户上下文和工具观察生成。"),
            bullets=self._coerce_text_list(data.get("card_bullets"), ["继续补充目标、时间和限制，我可以进一步细化。"]),
            data={"intent": intent, "planner": planner},
        )
        return (
            str(data.get("content") or fallback_content),
            str(data.get("reasoning_summary") or fallback_reasoning),
            self._coerce_text_list(data.get("next_actions"), fallback_next_actions),
            card,
            result,
            None,
        )

    async def _compose_dialogue_response(
        self,
        mode: str,
        request: PostMessageRequest,
        conversation_context: dict[str, Any],
        intent: dict[str, Any],
        planner: dict[str, Any],
        dialogue: dict[str, Any],
        *,
        proposals: list[dict[str, Any]] | None = None,
        validation_warnings: list[str] | None = None,
        degraded_reason: str | None = None,
    ) -> tuple[str, str, list[str], StructuredLLMResult | None, str | None]:
        operation_label = str(dialogue.get("operation_label") or self._operation_label(str(intent.get("intent") or ""), planner.get("write_domain")))
        chips = self._coerce_text_list(dialogue.get("chips"), [])
        proposal_count = len(proposals or [])
        warnings = [str(item) for item in (validation_warnings or []) if str(item).strip()]

        if mode == "propose" and proposal_count > 0:
            fallback_content = (
                f"收到，我先按“{operation_label}”理解，整理成了 {proposal_count} 条待确认卡片。"
                "你确认后我再写入；如果哪里不对，直接告诉我怎么改。"
            )
            fallback_reasoning = "本轮识别到明确操作意图且关键信息足够，所以只生成待确认提案，不直接写入数据。"
            fallback_next_actions = ["检查待确认卡片", "确认执行", "告诉我哪里要改"]
        elif mode == "propose":
            fallback_content = (
                f"我听懂你想{operation_label}，但现在还差一点关键信息，暂时不把它做成可执行卡片。"
                "你补一句目标对象或具体数值，我马上接着整理。"
            )
            fallback_reasoning = "本轮虽然进入操作意图，但提案校验没有得到足够安全的结构化草稿。"
            fallback_next_actions = warnings[:3] or ["补充具体目标", "补充时间或数值", "先当建议聊"]
        elif mode == "confirm_operation":
            question = str(dialogue.get("question") or f"你是想让我{operation_label}，还是先只是聊聊？")
            fallback_content = f"{question} 我先不替你生成卡片，等你点明后再动。"
            fallback_reasoning = "本轮像是有操作意图，但目标或写入意愿还不够明确，因此先确认，不调用写入提案工具。"
            fallback_next_actions = chips or ["整理成待确认卡片", "先聊聊", "我补充细节"]
        else:
            question = str(dialogue.get("question") or "我先问一个关键问题，确认后再继续。")
            fallback_content = question
            fallback_reasoning = "本轮缺少关键字段或存在安全边界问题，因此先追问一个最重要的问题。"
            fallback_next_actions = chips or ["补充目标", "补充时间", "先给建议"]

        if warnings and mode == "propose":
            fallback_next_actions = [*warnings, *fallback_next_actions][:3]

        if degraded_reason or not self.llm.is_enabled():
            return fallback_content, fallback_reasoning, fallback_next_actions, None, degraded_reason or "llm_disabled"

        if mode in {"clarify", "confirm_operation"} or (mode == "propose" and proposal_count > 0):
            return fallback_content, fallback_reasoning, fallback_next_actions, None, None

        system_prompt = (
            "You are GymPal, a training buddy and non-medical fitness coach. "
            f"Reply in {self._detect_reply_language(request.text)}. "
            "Return JSON only with keys: content, reasoning_summary, next_actions. "
            "Sound warm, direct, and concise. Do not overdo slang. "
            "For clarify or confirm_operation, ask exactly one concrete question. "
            "For propose, say the proposal is pending confirmation and never claim data was written. "
            "Do not expose internal reasoning, trace labels, LLM/planner/tool names, or process headings in content."
        )
        user_prompt = json.dumps(
            {
                "mode": mode,
                "message": request.text,
                "conversation_context": conversation_context,
                "intent": intent,
                "planner": planner,
                "dialogue": dialogue,
                "proposal_count": proposal_count,
                "validation_warnings": warnings,
                "fallback": {
                    "content": fallback_content,
                    "reasoning_summary": fallback_reasoning,
                    "next_actions": fallback_next_actions,
                },
            },
            ensure_ascii=False,
        )
        result = await asyncio.to_thread(self.llm.generate_structured_with_metadata, system_prompt, user_prompt)
        if not result.ok:
            return fallback_content, fallback_reasoning, fallback_next_actions, result, result.error_code or "llm_dialogue_composer_failed"

        data = result.data
        return (
            str(data.get("content") or fallback_content),
            str(data.get("reasoning_summary") or fallback_reasoning),
            self._coerce_text_list(data.get("next_actions"), fallback_next_actions),
            result,
            None,
        )

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
            "create_diet_log": "记录饮食日志",
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

        has_operation_marker = self._contains_marker(text, self.OPERATION_MARKERS)

        if self._contains_marker(text, self.BODY_METRIC_MARKERS) and (any(char.isdigit() for char in text) or has_operation_marker):
            return "body_metric"

        explicit_memory_markers = (
            "记住",
            "帮我记",
            "以后请",
            "以后不要",
            "以后别",
            "请以后",
            "我的偏好",
            "我偏好",
            "我不喜欢",
            "我喜欢",
            "不要给我安排",
            "优先安排",
        )
        explicit_memory_markers_en = (
            "remember that",
            "please remember",
            "my preference",
            "i prefer",
            "i don't like",
            "do not assign",
            "avoid for me",
        )
        is_question = text.strip().endswith(("?", "？", "吗"))
        has_explicit_memory_marker = any(marker in text for marker in explicit_memory_markers if marker != "帮我记") or (
            "帮我记" in text and "帮我记录" not in text
        )
        if (has_explicit_memory_marker or any(marker in lowered for marker in explicit_memory_markers_en)) and (
            not is_question or "记住" in text or "remember" in lowered
        ):
            return "memory"

        if self._is_explicit_meal_plan_request(text):
            return "meal_plan"

        if any(keyword in text for keyword in ("睡", "步", "喝水", "疲劳", "打卡")) and any(
            verb in text for verb in ("记录", "录入", "补充", "添加", "写入")
        ):
            return "daily_checkin"

        if self._has_diet_log_write_signal(text):
            return "diet_log"

        if any(keyword in text for keyword in ("训练了", "练了", "workout", "训练日志", "训练记录", "锻炼")) and any(
            verb in text for verb in ("记录", "录入", "添加", "写入")
        ):
            return "workout_log"

        if self._is_explicit_workout_plan_request(text):
            return "plan"

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
            "Be concise but complete, safe, and grounded in the provided context. "
            "Use 2-4 short paragraphs for normal answers and add detail when the user asks for planning or explanation."
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
        extra_steps: list[RunStep] | None = None,
        run_id: str | None = None,
    ) -> RunRecord:
        steps = [
            RunStep(
                id=str(uuid.uuid4()),
                step_type="thinking_summary",
                title="推理摘要",
                payload={"reasoning_summary": reasoning_summary},
            )
        ]
        steps.extend(extra_steps or [])
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
        return RunRecord(id=run_id or str(uuid.uuid4()), thread_id=thread_id, risk_level=risk_level, steps=steps)

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
                "payload": proposal.get("payload") if isinstance(proposal.get("payload"), dict) else {},
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
                "strategyTemplateId": review.get("strategy_template_id"),
                "strategyVersion": review.get("strategy_version"),
                "evidence": review.get("evidence"),
                "uncertaintyFlags": review.get("uncertainty_flags") or [],
                "resultSnapshot": result,
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
                "strategyTemplateId": review.get("strategy_template_id"),
                "strategyVersion": review.get("strategy_version"),
                "evidence": review.get("evidence"),
                "uncertaintyFlags": review.get("uncertainty_flags") or [],
                "resultSnapshot": result,
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
                "strategyTemplateId": proposal_group.get("strategy_template_id"),
                "strategyVersion": proposal_group.get("strategy_version"),
                "policyLabels": proposal_group.get("policy_labels") or [],
            },
        )

    def _build_memory_candidate_card(self, proposal: dict[str, Any]) -> Card | None:
        if proposal.get("action_type") not in {"create_coaching_memory", "update_coaching_memory"}:
            return None

        payload = proposal.get("payload") if isinstance(proposal.get("payload"), dict) else {}
        preview = proposal.get("preview") if isinstance(proposal.get("preview"), dict) else {}
        memory_type = str(payload.get("memoryType") or preview.get("记忆类型") or "behavior_pattern")
        confidence = payload.get("confidence") or preview.get("置信度") or 60
        summary = str(payload.get("summary") or proposal.get("summary") or "待确认长期记忆")
        bullets = [
            f"类型: {memory_type}",
            f"置信度: {confidence}%",
            "确认后才会影响后续复盘和教练包。",
        ]

        return Card(
            type="memory_candidate_card",
            title="待确认教练记忆",
            description=summary,
            bullets=bullets,
            data={
                "proposalId": proposal.get("id"),
                "memoryType": memory_type,
                "confidence": confidence,
                "preview": preview,
                "sourceType": payload.get("sourceType"),
            },
        )

    def _build_evidence_card(self, review: dict[str, Any]) -> Card | None:
        evidence = review.get("evidence") if isinstance(review.get("evidence"), dict) else {}
        result = review.get("result_snapshot") if isinstance(review.get("result_snapshot"), dict) else {}
        uncertainty_flags = review.get("uncertainty_flags") if isinstance(review.get("uncertainty_flags"), list) else []
        evidence_items: list[str] = []

        selected_because = evidence.get("selectedBecause")
        if selected_because:
            evidence_items.append(f"策略依据: {selected_because}")

        for key in ("adherenceScore", "riskFlags", "recommendationTags", "memoryCount"):
            value = evidence.get(key)
            if value not in (None, "", []):
                evidence_items.append(f"{key}: {value}")

        outcome_evidence = result.get("outcome_evidence")
        if isinstance(outcome_evidence, list):
            evidence_items.extend(str(item) for item in outcome_evidence[:2])

        if uncertainty_flags:
            evidence_items.append(f"不确定性: {' / '.join(str(flag) for flag in uncertainty_flags[:3])}")

        if not evidence_items:
            return None

        return Card(
            type="evidence_card",
            title="本次建议依据",
            description="事实、推断和不确定性会单独展示，避免把推断误当成系统事实。",
            bullets=evidence_items[:6],
            data={
                "reviewId": review.get("id"),
                "evidence": evidence,
                "uncertaintyFlags": uncertainty_flags,
                "resultSnapshot": result,
            },
        )

    def _build_strategy_decision_card(self, review: dict[str, Any], proposal_group: dict[str, Any]) -> Card | None:
        strategy_template_id = review.get("strategy_template_id") or proposal_group.get("strategy_template_id")
        strategy_version = review.get("strategy_version") or proposal_group.get("strategy_version")
        policy_labels = proposal_group.get("policy_labels") if isinstance(proposal_group.get("policy_labels"), list) else []

        if not strategy_template_id and not strategy_version and not policy_labels:
            return None

        bullets = []
        if strategy_version:
            bullets.append(f"策略版本: {strategy_version}")
        if policy_labels:
            bullets.extend(f"策略标签: {label}" for label in policy_labels[:4])

        return Card(
            type="strategy_decision_card",
            title="策略选择记录",
            description="这次复盘使用的策略版本会随 review/package 一起保存，便于后续回溯和调参。",
            bullets=bullets or ["已保存策略决策信息。"],
            data={
                "reviewId": review.get("id"),
                "proposalGroupId": proposal_group.get("id"),
                "strategyTemplateId": strategy_template_id,
                "strategyVersion": strategy_version,
                "policyLabels": policy_labels,
                "riskLevel": proposal_group.get("risk_level"),
            },
        )

    def _build_outcome_summary_card(self, review: dict[str, Any]) -> Card | None:
        result = review.get("result_snapshot") if isinstance(review.get("result_snapshot"), dict) else {}
        recent_outcomes = result.get("recent_outcomes") if isinstance(result.get("recent_outcomes"), dict) else {}
        items = recent_outcomes.get("items") if isinstance(recent_outcomes.get("items"), list) else []
        status_counts = recent_outcomes.get("statusCounts") if isinstance(recent_outcomes.get("statusCounts"), dict) else {}

        if not items and not status_counts:
            return None

        bullets = []
        for item in items[:3]:
            if isinstance(item, dict):
                status = item.get("status", "unknown")
                score = item.get("score")
                summary = str(item.get("summary") or "").strip()
                score_text = f" / 评分 {score}" if isinstance(score, (int, float)) else ""
                bullets.append(f"{status}{score_text}: {summary}" if summary else f"{status}{score_text}")

        if not bullets:
            bullets = [f"{key}: {value}" for key, value in list(status_counts.items())[:4]]

        return Card(
            type="outcome_summary_card",
            title="近期建议效果",
            description="历史 outcome 会作为约束进入本次建议，而不是被静默混入自由文本。",
            bullets=bullets[:4],
            data={
                "reviewId": review.get("id"),
                "recentOutcomes": recent_outcomes,
                "evidence": {"statusCounts": status_counts},
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
            status = {
                "positive": "improved",
                "mixed": "neutral",
                "negative": "worsened",
            }.get(status, status)
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

        if status_counts.get("improved", 0) > 0:
            constraints.append("Reuse patterns from recent improved outcomes; keep the next package similarly actionable.")
            recommendation_tags.append("outcome_improved")
        if status_counts.get("neutral", 0) > 0:
            constraints.append("Treat neutral outcomes as a signal to reduce complexity and add clearer recovery checks.")
            risk_flags.append("recent_neutral_outcome")
            recommendation_tags.append("outcome_neutral")
        if status_counts.get("worsened", 0) > 0:
            constraints.append("Avoid increasing intensity until the reason behind the worsened outcome is understood.")
            risk_flags.append("recent_worsened_outcome")
            recommendation_tags.append("outcome_worsened")
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

    def _build_next_week_plan_days(self, summary: dict[str, Any], recovery_mode: bool) -> list[dict[str, Any]]:
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

    def _collect_used_memories(self, coach_summary: dict[str, Any], flow_type: str | None = None) -> list[dict[str, Any]]:
        memory_summary = self._read_summary_value(coach_summary, "memorySummary", "memory_summary", fallback={})
        raw_memories = memory_summary.get("activeMemories") if isinstance(memory_summary, dict) else []
        if not isinstance(raw_memories, list):
            return []

        category_map = {
            "weekly_review": {"goal", "training_preference", "diet_preference", "equipment_constraint", "safety_constraint", "injury_or_pain", "coaching_outcome"},
            "daily_guidance": {"training_preference", "schedule_preference", "equipment_constraint", "safety_constraint", "injury_or_pain", "goal"},
        }
        allowed_categories = category_map.get(flow_type or "", set())
        used: list[dict[str, Any]] = []
        for memory in raw_memories[:12]:
            if not isinstance(memory, dict):
                continue
            category = str(memory.get("category") or memory.get("memoryType") or "")
            if allowed_categories and category not in allowed_categories:
                continue
            used.append(
                {
                    "id": memory.get("id"),
                    "category": category,
                    "title": memory.get("title"),
                    "summary": memory.get("summary"),
                    "confidence": memory.get("confidence"),
                    "relevanceTags": memory.get("relevanceTags") or [],
                }
            )
        return used[:8]

    def _build_programming_constraints(
        self,
        flow_type: str,
        user_text: str,
        coach_summary: dict[str, Any],
        exercise_catalog: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        completion = self._read_summary_value(coach_summary, "completion", fallback={})
        current_plan = self._read_summary_value(coach_summary, "currentPlan", "current_plan", fallback={})
        current_days = current_plan.get("days") if isinstance(current_plan, dict) else []
        checkins = self._read_summary_value(coach_summary, "recentDailyCheckins", "recent_daily_checkins", fallback=[])
        workouts = self._read_summary_value(coach_summary, "recentWorkoutLogs", "recent_workout_logs", fallback=[])
        latest_checkin = checkins[0] if isinstance(checkins, list) and checkins else {}
        sleep_hours = float(latest_checkin.get("sleepHours") or latest_checkin.get("sleep_hours") or 0)
        fatigue_level = str(latest_checkin.get("fatigueLevel") or latest_checkin.get("fatigue_level") or "moderate")
        recovery_mode = bool(sleep_hours and sleep_hours < 7) or fatigue_level == "high"
        days_per_week = len(current_days) if isinstance(current_days, list) and current_days else 3
        if re.search(r"(?:2|two|两|二)\s*(?:天|days?)", user_text, flags=re.IGNORECASE):
            days_per_week = 2
        elif re.search(r"(?:4|four|四)\s*(?:天|days?)", user_text, flags=re.IGNORECASE):
            days_per_week = 4
        elif re.search(r"(?:5|five|五)\s*(?:天|days?)", user_text, flags=re.IGNORECASE):
            days_per_week = 5

        session_duration = 45
        duration_match = re.search(r"(\d{2,3})\s*(?:min|分钟)", user_text, flags=re.IGNORECASE)
        if duration_match:
            session_duration = max(20, min(90, int(duration_match.group(1))))

        lowered = user_text.lower()
        goal = "consistency_and_recovery" if recovery_mode else "fat_loss"
        if "muscle" in lowered or "增肌" in user_text:
            goal = "muscle_gain"
        elif "maintain" in lowered or "维持" in user_text:
            goal = "maintenance"

        used_memories = self._collect_used_memories(coach_summary, flow_type)
        limitations = [
            str(memory.get("summary"))
            for memory in used_memories
            if memory.get("category") in {"equipment_constraint", "safety_constraint", "injury_or_pain"}
        ]
        preferences = [
            str(memory.get("summary"))
            for memory in used_memories
            if memory.get("category") in {"training_preference", "diet_preference", "schedule_preference", "goal", "dislike"}
        ]
        equipment = next(
            (str(memory.get("summary")) for memory in used_memories if memory.get("category") == "equipment_constraint"),
            "available gym or home equipment",
        )
        catalog_items: list[Any] = []
        if isinstance(exercise_catalog, dict) and isinstance(exercise_catalog.get("items"), list):
            catalog_items = exercise_catalog["items"][:20]
        outcome_context = self._build_outcome_context(coach_summary)

        return {
            "flow_type": flow_type,
            "goal": goal,
            "training_level": "beginner_to_intermediate",
            "days_per_week": max(1, min(6, days_per_week)),
            "session_duration_min": session_duration,
            "equipment": equipment,
            "limitations": limitations[:6],
            "preferences": preferences[:6],
            "sleep_hours": sleep_hours or None,
            "fatigue_level": fatigue_level,
            "recovery_mode": recovery_mode,
            "completion_rate": int(completion.get("completionRate") or completion.get("completion_rate") or 0),
            "recent_workout_count": len(workouts) if isinstance(workouts, list) else 0,
            "used_memories": used_memories,
            "outcome_constraints": outcome_context.get("constraints", []),
            "outcome_evidence": outcome_context.get("bullets", []),
            "exercise_catalog_sample": catalog_items,
        }

    def _fallback_coaching_generation(self, flow_type: str, constraints: dict[str, Any]) -> dict[str, Any]:
        days_per_week = int(constraints.get("days_per_week") or 3)
        duration = int(constraints.get("session_duration_min") or 45)
        recovery_mode = bool(constraints.get("recovery_mode"))
        goal = str(constraints.get("goal") or "consistency_and_recovery")
        focus_cycle = (
            ["Full-body strength", "Low-impact aerobic base", "Mobility and core", "Upper/lower strength"]
            if recovery_mode
            else ["Lower-body strength", "Upper-body strength", "Zone 2 conditioning", "Full-body strength", "Mobility and core"]
        )
        days: list[dict[str, Any]] = []
        for index in range(days_per_week):
            focus = focus_cycle[index % len(focus_cycle)]
            days.append(
                {
                    "dayLabel": f"Training day {index + 1}",
                    "focus": focus,
                    "duration": f"{duration} min",
                    "exercises": [
                        f"{focus} primary pattern 3x8",
                        "Accessory movement 3x10",
                        "Easy cooldown 8 min",
                    ],
                    "recoveryTip": "Keep RPE 6-7 and stop if pain increases." if recovery_mode else "Keep 1-2 reps in reserve and log RPE.",
                    "rpe": "6-7" if recovery_mode else "7-8",
                    "sortOrder": index,
                }
            )

        calorie = 2050 if recovery_mode else 2200
        return {
            "training_plan_draft": {
                "title": "Generated coaching plan",
                "goal": goal,
                "days": days,
                "progression": "Add one set or 2.5-5% load only after two comfortable completions.",
                "recovery_strategy": "Protect sleep, hydration, and one lower-load day each week.",
            },
            "nutrition_draft": {
                "userGoal": "recovery_support" if recovery_mode else goal,
                "targetCalorie": calorie,
                "totalCalorie": calorie,
                "proteinGrams": 150,
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
                    {"mealType": "dinner", "totalCalorie": max(350, calorie - 1300), "foods": []},
                ],
                "agentTips": [
                    "Prioritize protein at each meal.",
                    "Place most carbohydrates near training.",
                    "Avoid extreme calorie cuts when recovery signals are poor.",
                ],
                "restrictionNotes": constraints.get("limitations", []),
                "mealStrategy": "Simple high-protein meals with vegetables and training-day carbohydrates.",
            },
            "coaching_review_draft": {
                "title": "Weekly coaching review" if flow_type == "weekly_review" else "Daily coaching guidance",
                "summary": "Generated from recent plan, logs, memories, and recovery signals.",
                "focusAreas": [
                    "Protect recovery first." if recovery_mode else "Keep training consistency high.",
                    f"Use {days_per_week} sessions of about {duration} minutes.",
                ],
                "recommendationTags": [flow_type, goal, "coaching_generation"],
                "riskFlags": ["recovery_limited"] if recovery_mode else [],
                "guidance": [
                    "Train at a conservative RPE today." if recovery_mode else "Follow the planned session without adding extra volume.",
                    "Log completion, RPE, and pain after training.",
                ],
            },
            "quality": {"source": "rule_fallback", "warnings": []},
        }

    @staticmethod
    def _normalize_generated_days(raw_days: Any) -> list[dict[str, Any]]:
        days = raw_days if isinstance(raw_days, list) else []
        normalized: list[dict[str, Any]] = []
        for index, raw_day in enumerate(days[:6]):
            day = raw_day if isinstance(raw_day, dict) else {}
            exercises = day.get("exercises")
            normalized.append(
                {
                    "dayLabel": str(day.get("dayLabel") or day.get("label") or f"Training day {index + 1}"),
                    "focus": str(day.get("focus") or "Training focus"),
                    "duration": str(day.get("duration") or day.get("durationMin") or "45 min"),
                    "exercises": [str(item) for item in exercises[:6]] if isinstance(exercises, list) else [],
                    "recoveryTip": str(day.get("recoveryTip") or day.get("recovery_tip") or "Prioritize recovery quality."),
                    "rpe": str(day.get("rpe") or "7"),
                    "sortOrder": index,
                }
            )
        return normalized

    def _normalize_coaching_generation(
        self,
        raw: dict[str, Any],
        fallback: dict[str, Any],
        constraints: dict[str, Any],
    ) -> dict[str, Any]:
        training = raw.get("training_plan_draft") if isinstance(raw.get("training_plan_draft"), dict) else {}
        nutrition = raw.get("nutrition_draft") if isinstance(raw.get("nutrition_draft"), dict) else {}
        review = raw.get("coaching_review_draft") if isinstance(raw.get("coaching_review_draft"), dict) else {}
        fallback_training = fallback["training_plan_draft"]
        fallback_nutrition = fallback["nutrition_draft"]
        fallback_review = fallback["coaching_review_draft"]
        try:
            target_calorie = int(float(nutrition.get("targetCalorie") or nutrition.get("target_calorie") or fallback_nutrition["targetCalorie"]))
        except (TypeError, ValueError):
            target_calorie = int(fallback_nutrition["targetCalorie"])
        try:
            protein_grams = int(float(nutrition.get("proteinGrams") or nutrition.get("protein_grams") or fallback_nutrition["proteinGrams"]))
        except (TypeError, ValueError):
            protein_grams = int(fallback_nutrition["proteinGrams"])

        return {
            "training_plan_draft": {
                "title": str(training.get("title") or fallback_training["title"]),
                "goal": str(training.get("goal") or constraints.get("goal") or fallback_training["goal"]),
                "days": self._normalize_generated_days(training.get("days")) or fallback_training["days"],
                "progression": str(training.get("progression") or fallback_training["progression"]),
                "recovery_strategy": str(training.get("recovery_strategy") or training.get("recoveryStrategy") or fallback_training["recovery_strategy"]),
            },
            "nutrition_draft": {
                **fallback_nutrition,
                "userGoal": str(nutrition.get("userGoal") or nutrition.get("user_goal") or fallback_nutrition["userGoal"]),
                "targetCalorie": target_calorie,
                "totalCalorie": int(nutrition.get("totalCalorie") or target_calorie),
                "proteinGrams": protein_grams,
                "nutritionRatio": nutrition.get("nutritionRatio") if isinstance(nutrition.get("nutritionRatio"), dict) else fallback_nutrition["nutritionRatio"],
                "nutritionDetail": nutrition.get("nutritionDetail") if isinstance(nutrition.get("nutritionDetail"), dict) else fallback_nutrition["nutritionDetail"],
                "meals": nutrition.get("meals") if isinstance(nutrition.get("meals"), list) else fallback_nutrition["meals"],
                "agentTips": self._string_list(nutrition.get("agentTips")) or fallback_nutrition["agentTips"],
                "restrictionNotes": self._string_list(nutrition.get("restrictionNotes")) or fallback_nutrition["restrictionNotes"],
                "mealStrategy": str(nutrition.get("mealStrategy") or fallback_nutrition["mealStrategy"]),
            },
            "coaching_review_draft": {
                "title": str(review.get("title") or fallback_review["title"]),
                "summary": str(review.get("summary") or fallback_review["summary"]),
                "focusAreas": self._string_list(review.get("focusAreas")) or fallback_review["focusAreas"],
                "recommendationTags": self._string_list(review.get("recommendationTags")) or fallback_review["recommendationTags"],
                "riskFlags": self._string_list(review.get("riskFlags")) or fallback_review["riskFlags"],
                "guidance": self._string_list(review.get("guidance")) or fallback_review["guidance"],
            },
            "quality": {"source": "llm" if raw else "rule_fallback", "warnings": []},
        }

    def _validate_coaching_generation(self, generation: dict[str, Any]) -> tuple[list[str], list[str]]:
        blockers: list[str] = []
        warnings: list[str] = []
        training = generation.get("training_plan_draft") if isinstance(generation.get("training_plan_draft"), dict) else {}
        nutrition = generation.get("nutrition_draft") if isinstance(generation.get("nutrition_draft"), dict) else {}
        days = training.get("days") if isinstance(training.get("days"), list) else []
        if not days:
            blockers.append("training_days_empty")
        for day in days:
            item = day if isinstance(day, dict) else {}
            if not item.get("focus") or not item.get("exercises"):
                blockers.append("training_day_missing_focus_or_exercises")
                break
            if not item.get("recoveryTip"):
                blockers.append("missing_recovery_guidance")
                break
        try:
            calorie = int(float(nutrition.get("targetCalorie") or nutrition.get("totalCalorie")))
        except (TypeError, ValueError):
            calorie = 0
        if calorie < 1200 or calorie > 4500:
            blockers.append("unsafe_diet_calories")
        if not nutrition.get("agentTips"):
            warnings.append("missing_nutrition_tips")
        if not training.get("progression"):
            warnings.append("missing_progression_strategy")
        return self._dedupe_text_items(blockers), self._dedupe_text_items(warnings)

    async def _generate_coaching_generation(
        self,
        flow_type: str,
        user_text: str,
        coach_summary: dict[str, Any],
        exercise_catalog: dict[str, Any] | None,
    ) -> tuple[dict[str, Any], list[RunStep], dict[str, Any], list[str]]:
        constraints = self._build_programming_constraints(flow_type, user_text, coach_summary, exercise_catalog)
        fallback = self._fallback_coaching_generation(flow_type, constraints)
        steps: list[RunStep] = []
        generation = fallback
        generation_warnings: list[str] = []

        if not self.llm.is_enabled():
            generation_warnings.append("coaching_generation_llm_disabled")
        else:
            system_prompt = (
                "You are a product-grade fitness coach planner. Return JSON only with keys "
                "training_plan_draft, nutrition_draft, coaching_review_draft. Respect injuries and pain, "
                "avoid medical claims, and include RPE, progression, recovery strategy, calories, protein, "
                "restriction notes, and meal strategy."
            )
            user_prompt = json.dumps(
                {
                    "flow_type": flow_type,
                    "user_message": user_text,
                    "programming_constraints": constraints,
                    "required_schema": {
                        "training_plan_draft": "title, goal, days[{dayLabel, focus, duration, exercises, recoveryTip, rpe}], progression, recovery_strategy",
                        "nutrition_draft": "userGoal, targetCalorie, totalCalorie, proteinGrams, nutritionRatio, nutritionDetail, meals, agentTips, restrictionNotes, mealStrategy",
                        "coaching_review_draft": "title, summary, focusAreas, recommendationTags, riskFlags, guidance",
                    },
                },
                ensure_ascii=False,
            )
            result = await asyncio.to_thread(self.llm.generate_structured_with_metadata, system_prompt, user_prompt)
            steps.append(
                RunStep(
                    id=str(uuid.uuid4()),
                    step_type="llm_call",
                    title="LLM coaching generation",
                    payload=self._llm_metadata_payload(result, "coaching_generation"),
                )
            )
            if result.ok:
                generation = self._normalize_coaching_generation(result.data, fallback, constraints)
            else:
                generation_warnings.append(f"llm_generation_failed:{result.error_code or 'unknown'}")

        blockers, validation_warnings = self._validate_coaching_generation(generation)
        warnings = self._dedupe_text_items([*generation_warnings, *validation_warnings])
        if blockers and self.llm.is_enabled():
            revision_prompt = json.dumps(
                {
                    "blockers": blockers,
                    "warnings": warnings,
                    "programming_constraints": constraints,
                    "current_generation": generation,
                },
                ensure_ascii=False,
            )
            revision = await asyncio.to_thread(
                self.llm.generate_structured_with_metadata,
                "Return JSON only. Revise the coaching generation to clear blockers without increasing risk.",
                revision_prompt,
            )
            steps.append(
                RunStep(
                    id=str(uuid.uuid4()),
                    step_type="llm_call",
                    title="LLM coaching revision",
                    payload=self._llm_metadata_payload(revision, "coaching_generation_revision"),
                )
            )
            if revision.ok:
                revised = self._normalize_coaching_generation(revision.data, fallback, constraints)
                revised_blockers, revised_warnings = self._validate_coaching_generation(revised)
                if not revised_blockers:
                    generation = revised
                    blockers = []
                    warnings = self._dedupe_text_items([*generation_warnings, *revised_warnings])
                else:
                    warnings = self._dedupe_text_items(
                        [*warnings, f"revision_unresolved_blockers:{','.join(revised_blockers)}"]
                    )
            else:
                warnings = self._dedupe_text_items(
                    [*warnings, f"llm_generation_revision_failed:{revision.error_code or 'unknown'}"]
                )

        if blockers:
            generation = fallback
            warnings = self._dedupe_text_items([*warnings, f"fallback_used_after_blockers:{','.join(blockers)}"])
        generation["quality"] = {
            **(generation.get("quality") if isinstance(generation.get("quality"), dict) else {}),
            "warnings": warnings,
            "constraints": constraints,
        }
        return generation, steps, constraints, warnings

    def _coaching_generation_to_package(
        self,
        flow_type: str,
        coach_summary: dict[str, Any],
        generation: dict[str, Any],
        constraints: dict[str, Any],
    ) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], str, str, list[str]]:
        completion = self._read_summary_value(coach_summary, "completion", fallback={})
        completion_rate = int(completion.get("completionRate") or completion.get("completion_rate") or 0)
        current_plan = self._read_summary_value(coach_summary, "currentPlan", "current_plan", fallback={})
        snapshot_fields = self._build_plan_snapshot_fields(current_plan if isinstance(current_plan, dict) else {})
        training = generation["training_plan_draft"]
        nutrition = generation["nutrition_draft"]
        review = generation["coaching_review_draft"]
        next_week_date = (datetime.utcnow() + timedelta(days=7)).date().isoformat()
        risk_flags = self._dedupe_text_items([str(item) for item in review.get("riskFlags", [])])
        recommendation_tags = self._dedupe_text_items([str(item) for item in review.get("recommendationTags", [])])
        quality = generation.get("quality") if isinstance(generation.get("quality"), dict) else {}

        if flow_type == "weekly_review":
            proposals = [
                self._draft_proposal(
                    action_type="generate_next_week_plan",
                    entity_type="workout_plan",
                    title=self._proposal_title("generate_next_week_plan"),
                    summary="Generate a personalized next-week training plan after confirmation.",
                    payload={
                        "title": str(training.get("title") or "Next week coaching plan"),
                        "goal": str(training.get("goal") or constraints.get("goal") or "maintenance"),
                        "weekOf": next_week_date,
                        "days": training.get("days", []),
                        "progression": training.get("progression"),
                        "recoveryStrategy": training.get("recovery_strategy"),
                    },
                    preview={
                        "goal": training.get("goal"),
                        "days": len(training.get("days", [])),
                        "progression": training.get("progression"),
                        "recoveryStrategy": training.get("recovery_strategy"),
                    },
                    snapshot_fields=snapshot_fields,
                ),
                self._draft_proposal(
                    action_type="generate_diet_snapshot",
                    entity_type="diet_snapshot",
                    title=self._proposal_title("generate_diet_snapshot"),
                    summary="Generate a nutrition snapshot matched to the training week after confirmation.",
                    payload={
                        "date": next_week_date,
                        "userGoal": nutrition.get("userGoal"),
                        "totalCalorie": nutrition.get("totalCalorie"),
                        "targetCalorie": nutrition.get("targetCalorie"),
                        "nutritionRatio": nutrition.get("nutritionRatio"),
                        "nutritionDetail": nutrition.get("nutritionDetail"),
                        "meals": nutrition.get("meals"),
                        "agentTips": nutrition.get("agentTips"),
                        "restrictionNotes": nutrition.get("restrictionNotes"),
                        "mealStrategy": nutrition.get("mealStrategy"),
                    },
                    preview={
                        "targetCalorie": nutrition.get("targetCalorie"),
                        "proteinGrams": nutrition.get("proteinGrams"),
                        "mealStrategy": nutrition.get("mealStrategy"),
                        "restrictionNotes": nutrition.get("restrictionNotes"),
                    },
                ),
            ]
        else:
            guidance = review.get("guidance") if isinstance(review.get("guidance"), list) else []
            proposals = [
                self._draft_proposal(
                    action_type="create_advice_snapshot",
                    entity_type="advice_snapshot",
                    title=self._proposal_title("create_advice_snapshot"),
                    summary="Save today's guidance after confirmation.",
                    payload={
                        "type": "daily_guidance",
                        "priority": "high" if constraints.get("recovery_mode") else "medium",
                        "summary": str(guidance[0]) if guidance else str(review.get("summary")),
                        "reasoningTags": recommendation_tags,
                        "actionItems": [str(item) for item in guidance[:4]],
                        "riskFlags": risk_flags,
                    },
                    preview={
                        "focus": str(review.get("focusAreas", ["guidance"])[0]),
                        "guidanceItems": len(guidance),
                        "recoveryMode": constraints.get("recovery_mode"),
                    },
                )
            ]

        used_memory_count = len(constraints.get("used_memories") if isinstance(constraints.get("used_memories"), list) else [])
        review_result = {
            "focus_areas": review.get("focusAreas", []),
            "risk_flags": risk_flags,
            "completion_rate": completion_rate,
            "generated_plan_days": len(training.get("days", [])),
            "training_plan_draft": training,
            "nutrition_draft": nutrition,
            "programming_constraints": constraints,
            "outcome_constraints": constraints.get("outcome_constraints", []),
            "outcome_evidence": constraints.get("outcome_evidence", []),
        }
        review_payload = {
            "type": flow_type,
            "title": str(review.get("title")),
            "summary": str(review.get("summary")),
            "status": "draft",
            "adherenceScore": completion_rate,
            "riskFlags": risk_flags,
            "focusAreas": [str(item) for item in review.get("focusAreas", [])],
            "recommendationTags": recommendation_tags,
            "inputSnapshot": {"coach_summary": coach_summary, "programming_constraints": constraints},
            "resultSnapshot": review_result,
            "evidence": {
                "completionRate": completion_rate,
                "memoryCount": used_memory_count,
                "outcomeEvidence": constraints.get("outcome_evidence", []),
                "qualityWarnings": quality.get("warnings", []),
            },
            "uncertaintyFlags": [str(item) for item in quality.get("warnings", [])],
        }
        group_payload = {
            "title": "Personalized coaching package" if flow_type == "weekly_review" else "Daily guidance package",
            "summary": "Generated from current context and waiting for confirmation.",
            "preview": {
                "goal": training.get("goal"),
                "trainingDays": len(training.get("days", [])),
                "targetCalories": nutrition.get("targetCalorie"),
                "proteinGrams": nutrition.get("proteinGrams"),
                "usedMemoryCount": used_memory_count,
                "qualityWarnings": quality.get("warnings", []),
            },
            "riskLevel": self._max_risk_level([proposal["riskLevel"] for proposal in proposals]),
        }
        assistant_message = (
            "我已经基于最近的训练、恢复、记忆和结果证据生成了一份待确认的教练包。确认后才会写入计划或饮食。"
            if flow_type == "weekly_review"
            else "我已经基于当前恢复状态生成了今日建议。确认后才会保存为建议快照。"
        )
        reasoning_summary = "本轮使用 coaching_generation: 先构造约束，再生成草案，通过本地质量校验后封装为 proposal package。"
        next_actions = (
            ["检查训练计划、RPE 和恢复策略。", "确认或拒绝整包。", "执行后在 workspace 追踪结果。"]
            if flow_type == "weekly_review"
            else ["查看今日建议。", "确认保存或继续调整。", "训练后补充 RPE 和疼痛反馈。"]
        )
        return review_payload, group_payload, proposals, assistant_message, reasoning_summary, next_actions

    async def _draft_coaching_package_v2(
        self,
        flow_type: str,
        user_text: str,
        coach_summary: dict[str, Any],
        exercise_catalog: dict[str, Any] | None,
    ) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], str, str, list[str], list[RunStep], list[str]]:
        generation, llm_steps, constraints, warnings = await self._generate_coaching_generation(
            flow_type,
            user_text,
            coach_summary,
            exercise_catalog,
        )
        review_payload, group_payload, proposals, assistant_message, reasoning_summary, next_actions = (
            self._coaching_generation_to_package(flow_type, coach_summary, generation, constraints)
        )
        return review_payload, group_payload, proposals, assistant_message, reasoning_summary, next_actions, llm_steps, warnings

    async def _mark_used_memories(
        self,
        memories: list[dict[str, Any]],
        authorization: str | None,
    ) -> None:
        for memory in memories[:8]:
            memory_id = memory.get("id")
            if not isinstance(memory_id, str) or not memory_id:
                continue
            try:
                await self.store.mark_memory_used(memory_id, authorization)
            except Exception as exc:
                logger.warning("Unable to mark coaching memory %s as used: %s", memory_id, exc)

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
        next_week_days = self._build_next_week_plan_days(coach_summary, recovery_mode)
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
                "周复盘在数据不足时会降级为最小建议，而不是伪造完整训练和饮食方案。"
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
        if domain == "diet_log":
            return self._diet_log_proposals(user_text)
        if domain == "meal_plan":
            return self._meal_plan_proposals(user_text)
        if domain == "plan":
            return self._plan_proposals(user_text, context)
        if domain == "memory":
            return self._memory_proposals(user_text, context)
        return []

    def _memory_type_from_text(self, user_text: str) -> str:
        lowered = user_text.lower()
        if any(keyword in lowered for keyword in ("goal", "目标", "想要", "希望")):
            return "goal"
        if any(keyword in lowered for keyword in ("injury", "pain", "疼", "痛", "受伤", "膝盖", "腰")):
            return "injury_or_pain"
        if any(keyword in lowered for keyword in ("allergy", "过敏", "乳糖", "素食")):
            return "diet_preference"
        if any(keyword in lowered for keyword in ("dislike", "不喜欢", "讨厌", "不想")):
            return "dislike"
        if any(keyword in lowered for keyword in ("prefer", "喜欢", "训练偏好", "力量", "有氧")):
            return "training_preference"
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

    def _memory_category_from_type(self, memory_type: str) -> str:
        category_map = {
            "recovery_pattern": "safety_constraint",
            "behavior_pattern": "training_preference",
        }
        allowed = {
            "profile_fact",
            "training_preference",
            "diet_preference",
            "schedule_preference",
            "equipment_constraint",
            "safety_constraint",
            "injury_or_pain",
            "goal",
            "dislike",
            "coaching_outcome",
        }
        return memory_type if memory_type in allowed else category_map.get(memory_type, "training_preference")

    def _memory_proposals(self, user_text: str, context: dict[str, Any]) -> list[dict[str, Any]]:
        memory_summary = context.get("memory_summary")
        active_memories = memory_summary.get("activeMemories") if isinstance(memory_summary, dict) else []
        normalized_text = re.sub(r"\s+", " ", user_text).strip()
        cleaned = re.sub(r"^(请)?(帮我)?记住[:,，：]?", "", normalized_text).strip()
        summary = cleaned[:120] if cleaned else normalized_text[:120]
        memory_type = self._memory_type_from_text(user_text)
        category = self._memory_category_from_type(memory_type)

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
                    "category": category,
                    "title": "用户偏好与约束",
                    "summary": summary,
                    "value": {
                        "rawText": normalized_text,
                        "extractedSummary": summary,
                    },
                    "confidence": 72,
                    "relevanceTags": [category, memory_type],
                    "conflictStatus": "candidate",
                    "sourceType": "chat",
                    "reason": "用户在聊天中明确要求记住长期偏好或约束。",
                },
                preview=preview,
            )
        ]

    def _find_memory_conflict(self, category: str, summary: str, active_memories: list[Any]) -> dict[str, Any] | None:
        normalized = summary.lower()
        negated = any(token in normalized for token in ("不再", "不要", "不喜欢", "not", "no longer", "dislike"))
        positive = any(token in normalized for token in ("喜欢", "可以", "改成", "prefer", "like"))
        for memory in active_memories:
            if not isinstance(memory, dict):
                continue
            memory_category = str(memory.get("category") or memory.get("memoryType") or "")
            if memory_category != category:
                continue
            old_summary = str(memory.get("summary") or "").lower()
            old_negated = any(token in old_summary for token in ("不再", "不要", "不喜欢", "not", "no longer", "dislike"))
            if (negated and not old_negated) or (positive and old_negated):
                return memory
        return None

    def _memory_extraction_proposals(
        self,
        user_text: str,
        assistant_content: str,
        conversation_context: dict[str, Any],
        source_message_id: str | None = None,
    ) -> list[dict[str, Any]]:
        lowered = user_text.lower()
        explicit = any(token in lowered for token in ("记住", "幫我記住", "帮我记住", "remember"))
        implicit = any(
            token in lowered
            for token in ("我喜欢", "我不喜欢", "我不能", "膝盖", "过敏", "目标是", "prefer", "dislike", "allergy")
        )
        if not explicit and not implicit:
            return []

        memory_summary = conversation_context.get("memory_summary") if isinstance(conversation_context.get("memory_summary"), dict) else {}
        active_memories = memory_summary.get("activeMemories") if isinstance(memory_summary, dict) else []
        normalized_text = re.sub(r"\s+", " ", user_text).strip()
        summary = re.sub(r"^(请|please)?\s*(帮我)?\s*(记住|remember)[:,：，]?", "", normalized_text, flags=re.IGNORECASE).strip()
        summary = summary[:160] if summary else normalized_text[:160]
        if not summary:
            return []

        memory_type = self._memory_type_from_text(user_text)
        category = self._memory_category_from_type(memory_type)
        confidence = 88 if explicit else 58
        relevance_tags = self._dedupe_text_items([category, memory_type, "chat_extraction"])
        conflict = self._find_memory_conflict(category, summary, active_memories if isinstance(active_memories, list) else [])
        if conflict and conflict.get("id"):
            return [
                self._draft_proposal(
                    action_type="update_coaching_memory",
                    entity_type="coaching_memory",
                    entity_id=str(conflict.get("id")),
                    title=self._proposal_title("update_coaching_memory"),
                    summary=f"Update a possibly conflicting coaching memory: {summary}",
                    payload={
                        "memoryId": conflict.get("id"),
                        "memoryType": memory_type,
                        "category": category,
                        "title": str(conflict.get("title") or "Updated coaching memory"),
                        "summary": summary,
                        "value": {"rawText": normalized_text, "previousSummary": conflict.get("summary")},
                        "confidence": confidence,
                        "relevanceTags": relevance_tags,
                        "sourceType": "chat",
                        "sourceMessageId": source_message_id,
                        "conflictGroupId": str(conflict.get("conflictGroupId") or conflict.get("id")),
                        "conflictStatus": "candidate",
                        "reason": "The user introduced a memory that appears to conflict with an existing memory.",
                    },
                    preview={"status": "conflict", "old": conflict.get("summary"), "new": summary, "category": category},
                )
            ]

        return [
            self._draft_proposal(
                action_type="create_coaching_memory",
                entity_type="coaching_memory",
                title=self._proposal_title("create_coaching_memory"),
                summary=f"Save a candidate coaching memory: {summary}",
                payload={
                    "memoryType": memory_type,
                    "category": category,
                    "title": "Coaching memory candidate",
                    "summary": summary,
                    "value": {"rawText": normalized_text, "assistantContext": assistant_content[:240]},
                    "confidence": confidence,
                    "relevanceTags": relevance_tags,
                    "sourceType": "chat",
                    "sourceMessageId": source_message_id,
                    "conflictStatus": "candidate",
                    "reason": "Extracted from chat. Confirmation is required before long-term memory is written.",
                },
                preview={"status": "candidate", "category": category, "summary": summary, "confidence": confidence},
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
        recorded_at, date_label = self._body_metric_recorded_at_from_text(user_text)
        if recorded_at:
            payload["recordedAt"] = recorded_at
            preview["日期"] = date_label or recorded_at[:10]
        if body_fat is not None:
            payload["bodyFatPct"] = body_fat
            preview["体脂(%)"] = body_fat
        if waist is not None:
            payload["waistCm"] = waist
            preview["腰围(cm)"] = waist

        summary_prefix = f"记录{date_label}身体指标" if date_label else "记录身体指标"
        return [
            self._draft_proposal(
                action_type="create_body_metric",
                entity_type="body_metric",
                title=self._proposal_title("create_body_metric"),
                summary=f"{summary_prefix}，体重 {weight} kg。",
                payload=payload,
                preview=preview,
            )
        ]

    def _body_metric_recorded_at_from_text(self, user_text: str) -> tuple[str | None, str | None]:
        lowered = user_text.lower()
        now = datetime.now().astimezone()
        for markers, day_offset, label in (
            (("前天", "the day before yesterday"), -2, "前天"),
            (("昨天", "昨日", "昨晚", "yesterday"), -1, "昨天"),
            (("今天", "今日", "今早", "今晚", "today"), 0, "今天"),
        ):
            if any(marker in lowered for marker in markers):
                target = now + timedelta(days=day_offset)
                return self._body_metric_recorded_at_iso(target.year, target.month, target.day), label

        full_date = re.search(r"(?<!\d)(19\d{2}|20\d{2})[年/\-.](\d{1,2})[月/\-.](\d{1,2})(?:日|号)?", user_text)
        if full_date:
            recorded_at = self._body_metric_recorded_at_iso(
                int(full_date.group(1)),
                int(full_date.group(2)),
                int(full_date.group(3)),
            )
            if recorded_at:
                return recorded_at, recorded_at[:10]

        month_day = re.search(r"(?<!\d)(\d{1,2})月(\d{1,2})(?:日|号)?", user_text)
        if month_day:
            recorded_at = self._body_metric_recorded_at_iso(now.year, int(month_day.group(1)), int(month_day.group(2)))
            if recorded_at:
                return recorded_at, recorded_at[:10]

        return None, None

    def _body_metric_recorded_at_iso(self, year: int, month: int, day: int) -> str | None:
        try:
            local_now = datetime.now().astimezone()
            recorded_at = local_now.replace(year=year, month=month, day=day, hour=12, minute=0, second=0, microsecond=0)
        except ValueError:
            return None
        return recorded_at.isoformat()

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

    def _diet_log_proposals(self, user_text: str) -> list[dict[str, Any]]:
        lowered = user_text.lower()
        if any(marker in user_text for marker in ("早餐", "早饭")) or "breakfast" in lowered:
            meal_type = "breakfast"
        elif any(marker in user_text for marker in ("午饭", "午餐")) or "lunch" in lowered:
            meal_type = "lunch"
        elif any(marker in user_text for marker in ("晚饭", "晚餐")) or "dinner" in lowered:
            meal_type = "dinner"
        elif any(marker in user_text for marker in ("加餐", "零食")) or any(marker in lowered for marker in ("snack", "meal prep")):
            meal_type = "snack"
        else:
            meal_type = "meal"

        total_calorie = self._extract_number(
            [r"(?:热量|大概|约|大约)?[^\d]*(\d+(?:\.\d+)?)\s*(?:卡|千卡|kcal)", r"calorie[^\d]*(\d+(?:\.\d+)?)"],
            user_text,
        )
        protein = self._extract_number([r"蛋白[^\d]*(\d+(?:\.\d+)?)\s*(?:g|克)?", r"protein[^\d]*(\d+(?:\.\d+)?)"], user_text)
        carbs = self._extract_number([r"碳水[^\d]*(\d+(?:\.\d+)?)\s*(?:g|克)?", r"carb[^\d]*(\d+(?:\.\d+)?)"], user_text)
        fat = self._extract_number([r"脂肪[^\d]*(\d+(?:\.\d+)?)\s*(?:g|克)?", r"fat[^\d]*(\d+(?:\.\d+)?)"], user_text)

        food_text = re.sub(r"^(帮我|请)?\s*(记录|录入|添加|写入)?\s*(一下|今天)?", "", user_text).strip()
        food_text = re.sub(r"(早餐|早饭|午饭|午餐|晚饭|晚餐|加餐|零食)?\s*(吃了|喝了|是)\s*", "", food_text).strip()
        food_text = re.sub(r"(大概|约|大约)?\d+(?:\.\d+)?\s*(卡|千卡|kcal).*", "", food_text, flags=re.IGNORECASE).strip()
        food_text = re.sub(r"(蛋白|碳水|脂肪)[^\s，,。；;]*", "", food_text).strip()
        foods = [
            item.strip(" ，,。；;、")
            for item in re.split(r"[，,。；;、/]+", food_text)
            if item.strip(" ，,。；;、")
        ]
        if not foods and any(marker in user_text for marker in ("吃了", "喝了", "早餐", "午饭", "晚饭", "加餐")):
            foods = [food_text or user_text.strip()]
        foods = foods[:8]

        if not foods and total_calorie is None and protein is None and carbs is None and fat is None:
            return []

        payload: dict[str, Any] = {
            "mealType": meal_type,
            "foods": foods,
            "note": user_text.strip()[:240],
        }
        preview: dict[str, Any] = {
            "餐次": meal_type,
            "食物": " / ".join(foods) if foods else "未拆分",
        }
        if total_calorie is not None:
            payload["totalCalorie"] = int(total_calorie)
            preview["热量(kcal)"] = int(total_calorie)
        if protein is not None:
            payload["proteinGrams"] = protein
            preview["蛋白(g)"] = protein
        if carbs is not None:
            payload["carbohydrateGrams"] = carbs
            preview["碳水(g)"] = carbs
        if fat is not None:
            payload["fatGrams"] = fat
            preview["脂肪(g)"] = fat

        return [
            self._draft_proposal(
                action_type="create_diet_log",
                entity_type="diet_log",
                title=self._proposal_title("create_diet_log"),
                summary="记录一条饮食日志。",
                payload=payload,
                preview=preview,
            )
        ]

    def _meal_plan_proposals(self, user_text: str) -> list[dict[str, Any]]:
        goal = self._detect_plan_goal(user_text) or "maintenance"
        if any(marker in user_text for marker in ("减肥", "减重", "控体重")):
            goal = "fat_loss"

        calorie = self._extract_number(
            [r"(\d+(?:\.\d+)?)\s*(?:卡|千卡|kcal)", r"calorie[^\d]*(\d+(?:\.\d+)?)"],
            user_text,
        )
        if calorie is None:
            calorie = 1800 if goal == "fat_loss" else 2400 if goal == "muscle_gain" else 2100
        target_calorie = max(1200, int(calorie))
        protein = 130 if goal == "fat_loss" else 150 if goal == "muscle_gain" else 120
        today = datetime.now().astimezone().date().isoformat()

        if goal == "fat_loss":
            meal_strategy = "温和热量缺口，优先保证蛋白质、蔬菜和训练日前后的碳水。"
            dinner_calorie = max(450, target_calorie - 1150)
        elif goal == "muscle_gain":
            meal_strategy = "小幅热量盈余，三餐都有蛋白质，训练前后补足碳水。"
            dinner_calorie = max(650, target_calorie - 1450)
        else:
            meal_strategy = "稳定总热量，蛋白质足量，主食和蔬菜按训练量灵活调整。"
            dinner_calorie = max(550, target_calorie - 1250)

        meals = [
            {"mealType": "breakfast", "totalCalorie": 450, "foods": ["高蛋白主食", "水果或蔬菜"]},
            {"mealType": "lunch", "totalCalorie": 700 if goal != "muscle_gain" else 850, "foods": ["优质蛋白", "米饭或杂粮", "蔬菜"]},
            {"mealType": "dinner", "totalCalorie": dinner_calorie, "foods": ["瘦肉/鱼/豆制品", "蔬菜", "适量主食"]},
        ]
        payload = {
            "date": today,
            "userGoal": goal,
            "totalCalorie": target_calorie,
            "targetCalorie": target_calorie,
            "proteinGrams": protein,
            "nutritionRatio": {"carbohydrate": 45, "protein": 30, "fat": 25},
            "nutritionDetail": {
                "protein": {"target": protein, "recommend": protein, "remaining": 0},
                "carbohydrate": {"target": int(target_calorie * 0.45 / 4), "recommend": int(target_calorie * 0.45 / 4), "remaining": 0},
                "fat": {"target": int(target_calorie * 0.25 / 9), "recommend": int(target_calorie * 0.25 / 9), "remaining": 0},
            },
            "meals": meals,
            "agentTips": [
                "不要采用极端低热量方案。",
                "每餐先保证蛋白质，再按训练量分配主食。",
                "如果有疾病、用药或饮食禁忌，需要按医生或营养师建议调整。",
            ],
            "restrictionNotes": [],
            "mealStrategy": meal_strategy,
        }
        return [
            self._draft_proposal(
                action_type="generate_diet_snapshot",
                entity_type="diet_snapshot",
                title=self._proposal_title("generate_diet_snapshot"),
                summary="生成一份待确认的饮食计划快照。",
                payload=payload,
                preview={
                    "目标": self._plan_goal_label(goal),
                    "热量目标": target_calorie,
                    "蛋白目标(g)": protein,
                    "餐次": len(meals),
                    "策略": meal_strategy,
                },
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

    @staticmethod
    def _plan_goal_label(goal: str | None) -> str:
        labels = {
            "muscle_gain": "增肌",
            "fat_loss": "减脂",
            "strength": "力量提升",
            "endurance": "耐力提升",
            "maintenance": "维持状态",
        }
        return labels.get(str(goal or ""), "综合训练")

    def _single_session_plan_day(self, slots: dict[str, Any]) -> dict[str, Any]:
        focus = str(slots.get("focus") or "full_body")
        goal = str(slots.get("goal") or "maintenance")
        equipment = str(slots.get("equipment") or "any")
        aggregate_text = str(slots.get("aggregate_text") or "")
        focus_labels = {
            "chest": "胸部增肌",
            "back": "背部训练",
            "legs": "臀腿训练",
            "shoulders": "肩部训练",
            "arms": "手臂训练",
            "push": "推力训练",
            "pull": "拉力训练",
            "full_body": "全身训练",
        }
        exercise_map = {
            "chest": [
                "上斜哑铃卧推 4组x8-10次",
                "平板杠铃卧推 3组x6-8次",
                "器械推胸 3组x10-12次",
                "绳索飞鸟 3组x12-15次",
            ],
            "back": ["高位下拉 4组x8-12次", "坐姿划船 3组x10-12次", "单臂哑铃划船 3组x10次", "面拉 3组x12-15次"],
            "legs": ["深蹲 4组x6-8次", "罗马尼亚硬拉 3组x8-10次", "腿举 3组x10-12次", "腿弯举 3组x12次"],
            "shoulders": ["哑铃推举 4组x8-10次", "侧平举 4组x12-15次", "俯身飞鸟 3组x12-15次", "面拉 3组x12-15次"],
            "arms": ["杠铃弯举 3组x8-10次", "绳索下压 3组x10-12次", "锤式弯举 3组x10次", "臂屈伸 3组x8-12次"],
            "full_body": ["深蹲 3组x8次", "卧推 3组x8次", "划船 3组x10次", "平板支撑 3组x45秒"],
        }
        exercises = list(exercise_map.get(focus, exercise_map["full_body"]))
        if focus == "chest" and equipment == "bodyweight":
            exercises = ["标准俯卧撑 4组x接近力竭", "下斜俯卧撑 3组x8-12次", "宽距俯卧撑 3组x10-15次", "慢速离心俯卧撑 2组x6-8次"]
        goal_label = self._plan_goal_label(goal)
        day_label = "今天" if "今天" in aggregate_text else ("练胸日" if focus == "chest" else "训练日")
        return {
            "dayLabel": day_label,
            "focus": f"{focus_labels.get(focus, '训练')} · {goal_label}",
            "duration": "55-65 分钟" if goal == "muscle_gain" else "45-60 分钟",
            "exercises": exercises,
            "recoveryTip": "全程保留1-2次余量；如果肩、肘或胸口不适，降低重量并停止高风险动作。",
        }

    def _plan_proposals(self, user_text: str, context: dict[str, Any]) -> list[dict[str, Any]]:
        current_plan = context.get("current_plan")
        days = current_plan.get("days", []) if isinstance(current_plan, dict) else []
        matched_day = self._extract_day_label(user_text, days if isinstance(days, list) else [])
        lowered = user_text.lower()
        conversation_context = context.get("conversation_context") if isinstance(context.get("conversation_context"), dict) else {}
        slots = self._plan_generation_slots(user_text, conversation_context)
        aggregate_text = str(slots.get("aggregate_text") or user_text)
        aggregate_lowered = aggregate_text.lower()

        if not isinstance(current_plan, dict) or not current_plan.get("plan"):
            if slots.get("active") or any(keyword in aggregate_text for keyword in ("生成", "创建", "安排", "下周")) or "plan" in aggregate_lowered:
                goal = str(slots.get("goal") or "fat_loss")
                if "增肌" in aggregate_text or "muscle" in aggregate_lowered:
                    goal = "muscle_gain"
                if "维持" in aggregate_text or "maintenance" in aggregate_lowered:
                    goal = "maintenance"
                payload: dict[str, Any] = {"goal": goal}
                preview: dict[str, Any] = {"目标": self._plan_goal_label(goal)}
                if slots.get("focus") or slots.get("frequency") == "single_session":
                    day = self._single_session_plan_day({**slots, "goal": goal})
                    payload.update({"title": f"{day['dayLabel']}训练计划", "days": [day]})
                    preview.update({"训练日": day["focus"], "时长": day["duration"], "动作数": len(day["exercises"])})
                return [
                    self._draft_proposal(
                        action_type="generate_plan",
                        entity_type="workout_plan",
                        title=self._proposal_title("generate_plan"),
                        summary="生成一份新的训练计划。",
                        payload=payload,
                        preview=preview,
                    )
                ]
            return []

        snapshot_fields = self._build_plan_snapshot_fields(current_plan, matched_day)

        if slots.get("active") and slots.get("goal") and (slots.get("focus") or slots.get("frequency") == "single_session"):
            day = self._single_session_plan_day(slots)
            return [
                self._draft_proposal(
                    action_type="create_plan_day",
                    entity_type="workout_plan_day",
                    title=self._proposal_title("create_plan_day"),
                    summary="新增一条单次训练日安排。",
                    payload=day,
                    preview={
                        "日期": day["dayLabel"],
                        "计划项": day["focus"],
                        "时长": day["duration"],
                        "动作数": len(day["exercises"]),
                    },
                    snapshot_fields=self._build_plan_snapshot_fields(current_plan),
                )
            ]

        if self._is_delete_all_plan_request(user_text):
            delete_targets = [day for day in days if isinstance(day, dict) and day.get("id")]
            snapshot_fields = self._build_plan_snapshot_fields(current_plan)
            return [
                self._draft_proposal(
                    action_type="delete_plan_day",
                    entity_type="workout_plan_day",
                    entity_id=str(day.get("id")),
                    title=self._proposal_title("delete_plan_day"),
                    summary=f"删除计划项“{day.get('dayLabel')} - {day.get('focus')}”。",
                    payload={"dayId": day.get("id")},
                    preview={
                        "批量操作": "删除当前计划的所有训练日",
                        "总计划项数": len(delete_targets),
                        "日期": day.get("dayLabel"),
                        "计划项": day.get("focus"),
                    },
                    snapshot_fields=snapshot_fields,
                )
                for day in delete_targets
            ]

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
            if action_type == "generate_diet_snapshot":
                try:
                    target_calorie = float(payload.get("targetCalorie") or payload.get("totalCalorie") or 0)
                except (TypeError, ValueError):
                    target_calorie = 0
                if target_calorie and target_calorie < 1200:
                    warnings.append("已忽略极低热量饮食方案，建议改成更温和、安全的热量缺口。")
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
        extra_steps: list[RunStep] | None = None,
        degraded_mode: bool = False,
        degraded_reason: str | None = None,
        intent_confidence: float = 1.0,
        source_message_id: str | None = None,
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
            reasoning_summary = "复盘流依赖聚合上下文；这次读取失败，所以不继续生成教练包。"
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
                extra_steps=extra_steps,
            )
            await self.store.save_run(run, authorization)
            await self._persist_tool_events(thread_id, run.id, tool_events, authorization, "coaching_flow")
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
                degraded_mode=degraded_mode,
                degraded_reason=degraded_reason,
                intent=flow_type,
                intent_confidence=intent_confidence,
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
            reasoning_summary = "同一账号存在待确认教练包时，会优先恢复现有状态，而不是重复生成新的教练包。"
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
                extra_steps=extra_steps,
            )
            await self.store.save_run(run, authorization)
            await self._persist_tool_events(thread_id, run.id, tool_events, authorization, "coaching_flow")
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
                degraded_mode=degraded_mode,
                degraded_reason=degraded_reason,
                intent=flow_type,
                intent_confidence=intent_confidence,
            )

        tool_events.append(ToolEvent(event="tool_call_started", tool_name="get_exercise_catalog", summary="Load exercise catalog"))
        exercise_catalog = await self.tools.get_exercise_catalog()
        tool_events.append(
            ToolEvent(
                event="tool_call_completed",
                tool_name="get_exercise_catalog",
                summary=exercise_catalog.human_readable,
                payload=self._tool_payload(exercise_catalog),
            )
        )

        review_payload, group_payload, proposals, assistant_message, reasoning_summary, next_actions, generation_steps, generation_warnings = (
            await self._draft_coaching_package_v2(
                flow_type,
                request.text,
                coach_summary.data,
                exercise_catalog.data if exercise_catalog.ok else None,
            )
        )
        used_memories = self._collect_used_memories(coach_summary.data, flow_type)
        await self._mark_used_memories(used_memories, authorization)
        generation_degraded_warnings = [
            warning
            for warning in generation_warnings
            if warning.startswith(
                (
                    "coaching_generation_llm_disabled",
                    "llm_generation_failed",
                    "llm_generation_revision_failed",
                    "fallback_used_after_blockers",
                )
            )
        ]
        if generation_degraded_warnings:
            generation_degraded_reason = "; ".join(generation_degraded_warnings[:3])
            degraded_mode = True
            degraded_reason = degraded_reason or generation_degraded_reason
            generation_steps.append(
                RunStep(
                    id=str(uuid.uuid4()),
                    step_type="degraded_mode",
                    title="Coaching generation limited",
                    payload={"reason": generation_degraded_reason, "warnings": generation_warnings},
                )
            )

        run = self._build_run(
            thread_id=thread_id,
            risk_level=self._max_risk_level([proposal["riskLevel"] for proposal in proposals]),
            tool_events=tool_events,
            cards=[],
            content=assistant_message,
            reasoning_summary=reasoning_summary,
            extra_steps=[*(extra_steps or []), *generation_steps],
        )
        await self.store.save_run(run, authorization)
        await self._persist_tool_events(thread_id, run.id, tool_events, authorization, "coaching_flow")

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

        primary_review_card = (
            self._build_weekly_review_card(review) if flow_type == "weekly_review" else self._build_daily_guidance_card(review)
        )
        optional_cards = [
            self._build_evidence_card(review),
            self._build_strategy_decision_card(review, proposal_group),
            self._build_outcome_summary_card(review),
        ]
        cards = [
            primary_review_card,
            *(card for card in optional_cards if card is not None),
            self._build_proposal_group_card(proposal_group),
        ]
        created_memory_proposal_count = 0
        memory_context = {
            "memory_summary": self._read_summary_value(
                coach_summary.data,
                "memorySummary",
                "memory_summary",
                fallback={},
            )
        }
        memory_drafts, memory_warnings = self._validate_proposals(
            self._memory_extraction_proposals(request.text, assistant_message, memory_context, source_message_id)
        )
        if memory_drafts:
            created_memory_proposals = await self.store.create_proposals(thread_id, run.id, memory_drafts, authorization)
            created_memory_proposal_count = len(created_memory_proposals)
            for proposal in created_memory_proposals:
                memory_card = self._build_memory_candidate_card(proposal)
                if memory_card is not None:
                    cards.append(memory_card)
                cards.append(self._build_proposal_card(proposal))
        if memory_warnings:
            next_actions = [*memory_warnings, *next_actions][:3]
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
            degraded_mode=degraded_mode,
            degraded_reason=degraded_reason,
            intent=flow_type,
            intent_confidence=intent_confidence,
            used_memories=used_memories,
            pending_proposal_count=len(proposals) + created_memory_proposal_count,
        )

    async def process_message(
        self,
        thread_id: str,
        request: PostMessageRequest,
        authorization: str | None = None,
    ) -> PostMessageResponse:
        user_message = MessageRecord(id=str(uuid.uuid4()), role="user", content=request.text)
        await self.store.append_message(thread_id, user_message, authorization)

        conversation_context = await self._load_conversation_context(thread_id, request.text, authorization)
        intent, intent_llm, degraded_reason = await self._classify_intent(request, conversation_context)
        degraded_mode = degraded_reason is not None
        planner, planner_llm, planner_degraded_reason = await self._plan_next_steps(
            request,
            conversation_context,
            intent,
            degraded_reason,
        )
        if planner_degraded_reason and not degraded_reason:
            degraded_reason = planner_degraded_reason
            degraded_mode = True

        dialogue = self._decide_dialogue_turn(request, conversation_context, intent, planner)
        intent = dialogue.get("intent") if isinstance(dialogue.get("intent"), dict) else intent
        planner = dialogue.get("planner") if isinstance(dialogue.get("planner"), dict) else planner

        write_domain = str(
            planner.get("write_domain")
            or (intent.get("write_domain") if planner.get("action") == "propose" else None)
            or self._detect_write_domain(request.text)
            or ""
        )
        self.trace.log(
            user_id=self._extract_user_id_from_authorization(authorization),
            thread_id=thread_id,
            text=request.text,
            write_domain=write_domain,
            intent=intent,
            planner=planner,
            degraded_reason=degraded_reason,
        )

        base_extra_steps = []
        if intent_llm is not None:
            base_extra_steps.append(
                RunStep(
                    id=str(uuid.uuid4()),
                    step_type="llm_call",
                    title="LLM 意图识别",
                    payload=self._llm_metadata_payload(intent_llm, "intent_classifier"),
                )
            )
        base_extra_steps.append(
            RunStep(
                id=str(uuid.uuid4()),
                step_type="intent_classification",
                title="意图识别",
                payload=intent,
            )
        )
        if planner_llm is not None:
            base_extra_steps.append(
                RunStep(
                    id=str(uuid.uuid4()),
                    step_type="llm_call",
                    title="LLM Planner",
                    payload=self._llm_metadata_payload(planner_llm, "planner"),
                )
            )
        base_extra_steps.append(
            RunStep(
                id=str(uuid.uuid4()),
                step_type="planner_decision",
                title="Planner 决策",
                payload=planner,
            )
        )
        if degraded_mode:
            base_extra_steps.append(
                RunStep(
                    id=str(uuid.uuid4()),
                    step_type="degraded_mode",
                    title="受限模式",
                    payload={"reason": degraded_reason},
                )
            )

        dialogue_mode = str(dialogue.get("mode") or planner.get("action") or "answer")
        if dialogue_mode in {"clarify", "confirm_operation"}:
            content, reasoning_summary, next_actions, dialogue_llm, dialogue_degraded_reason = await self._compose_dialogue_response(
                dialogue_mode,
                request,
                conversation_context,
                intent,
                planner,
                dialogue,
                degraded_reason=degraded_reason,
            )
            if dialogue_degraded_reason and not degraded_reason:
                degraded_reason = dialogue_degraded_reason
                degraded_mode = True
            cards: list[Card] = []
            extra_steps = list(base_extra_steps)
            if dialogue_llm is not None:
                extra_steps.append(
                    RunStep(
                        id=str(uuid.uuid4()),
                        step_type="llm_call",
                        title="LLM 对话回复",
                        payload=self._llm_metadata_payload(dialogue_llm, "dialogue_composer"),
                    )
                )
            if degraded_mode and not any(step.step_type == "degraded_mode" for step in extra_steps):
                extra_steps.append(
                    RunStep(
                        id=str(uuid.uuid4()),
                        step_type="degraded_mode",
                        title="受限模式",
                        payload={"reason": degraded_reason},
                    )
                )
            clarify_risk_level = str(planner.get("risk_level") or "medium")
            if clarify_risk_level not in {"low", "medium", "high"}:
                clarify_risk_level = "medium"
            run = self._build_run(
                thread_id=thread_id,
                risk_level=clarify_risk_level,
                tool_events=[],
                cards=cards,
                content=content,
                reasoning_summary=reasoning_summary,
                extra_steps=extra_steps,
            )
            await self.store.save_run(run, authorization)
            message = await self._append_assistant_message(thread_id, content, reasoning_summary, cards, authorization)
            return PostMessageResponse(
                id=message.id,
                content=message.content,
                reasoning_summary=message.reasoning_summary or reasoning_summary,
                cards=cards,
                run_id=run.id,
                tool_events=[],
                next_actions=next_actions,
                risk_level=run.risk_level,
                degraded_mode=degraded_mode,
                degraded_reason=degraded_reason,
                intent=str(intent.get("intent") or ""),
                intent_confidence=float(intent.get("confidence") or 0.0),
                clarification={"question": content, "chips": next_actions},
            )

        intent_name = str(intent.get("intent") or "")
        if intent_name == "weekly_review":
            return await self._process_coaching_flow(
                "weekly_review",
                thread_id,
                request,
                authorization,
                extra_steps=base_extra_steps,
                degraded_mode=degraded_mode,
                degraded_reason=degraded_reason,
                intent_confidence=float(intent.get("confidence") or 0.0),
                source_message_id=user_message.id,
            )

        if intent_name == "daily_guidance":
            return await self._process_coaching_flow(
                "daily_guidance",
                thread_id,
                request,
                authorization,
                extra_steps=base_extra_steps,
                degraded_mode=degraded_mode,
                degraded_reason=degraded_reason,
                intent_confidence=float(intent.get("confidence") or 0.0),
                source_message_id=user_message.id,
            )

        run_id = str(uuid.uuid4())
        observations, tool_events, proposals, validation_warnings = await self._execute_planner_tools(
            thread_id,
            run_id,
            request,
            planner,
            authorization,
            conversation_context,
        )
        compose_llm: StructuredLLMResult | None = None

        if proposals or planner.get("action") == "propose":
            content, reasoning_summary, next_actions, compose_llm, compose_degraded_reason = await self._compose_dialogue_response(
                "propose",
                request,
                conversation_context,
                intent,
                planner,
                dialogue,
                proposals=proposals,
                validation_warnings=validation_warnings,
                degraded_reason=degraded_reason,
            )
            if compose_degraded_reason and not degraded_reason:
                degraded_reason = compose_degraded_reason
                degraded_mode = True
            cards: list[Card] = []
            risk_level = self._max_risk_level([proposal["riskLevel"] for proposal in proposals]) if proposals else "medium"
        else:
            content, reasoning_summary, next_actions, response_card, compose_llm, compose_degraded_reason = await self._compose_planned_response(
                request,
                conversation_context,
                intent,
                planner,
                observations,
                degraded_reason,
            )
            if compose_degraded_reason and not degraded_reason:
                degraded_reason = compose_degraded_reason
                degraded_mode = True
            cards = []
            if response_card is not None:
                cards.append(response_card)
            risk_level = str(planner.get("risk_level") or "medium")
            if risk_level not in {"low", "medium", "high"}:
                risk_level = "medium"

        extra_steps = list(base_extra_steps)
        if compose_llm is not None:
            extra_steps.append(
                RunStep(
                    id=str(uuid.uuid4()),
                    step_type="llm_call",
                    title="LLM 回复合成",
                    payload=self._llm_metadata_payload(compose_llm, "response_composer"),
                )
            )
        if degraded_mode and not any(step.step_type == "degraded_mode" for step in extra_steps):
            extra_steps.append(
                RunStep(
                    id=str(uuid.uuid4()),
                    step_type="degraded_mode",
                    title="受限模式",
                    payload={"reason": degraded_reason},
                )
            )

        run = self._build_run(
            thread_id=thread_id,
            risk_level=risk_level,
            tool_events=tool_events,
            cards=cards,
            content=content,
            reasoning_summary=reasoning_summary,
            extra_steps=extra_steps,
            run_id=run_id,
        )
        await self.store.save_run(run, authorization)

        created_proposal_count = 0
        if proposals:
            created_proposals = await self.store.create_proposals(thread_id, run.id, proposals, authorization)
            created_proposal_count += len(created_proposals)
            for proposal in created_proposals:
                memory_card = self._build_memory_candidate_card(proposal)
                if memory_card is not None:
                    cards.append(memory_card)
                cards.append(self._build_proposal_card(proposal))
        if write_domain != "memory":
            memory_drafts, memory_warnings = self._validate_proposals(
                self._memory_extraction_proposals(request.text, content, conversation_context, user_message.id)
            )
            if memory_drafts:
                created_memory_proposals = await self.store.create_proposals(thread_id, run.id, memory_drafts, authorization)
                created_proposal_count += len(created_memory_proposals)
                for proposal in created_memory_proposals:
                    memory_card = self._build_memory_candidate_card(proposal)
                    if memory_card is not None:
                        cards.append(memory_card)
                    cards.append(self._build_proposal_card(proposal))
            if memory_warnings:
                next_actions = [*memory_warnings, *next_actions][:3]
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
            degraded_mode=degraded_mode,
            degraded_reason=degraded_reason,
            intent=str(intent.get("intent") or ""),
            intent_confidence=float(intent.get("confidence") or 0.0),
            pending_proposal_count=created_proposal_count,
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

        cards = [] if ok else [self._build_result_card(proposal_id, title, description, result_payload, proposal_status)]
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

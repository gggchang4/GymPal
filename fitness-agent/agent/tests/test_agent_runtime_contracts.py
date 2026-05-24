from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any


AGENT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENT_ROOT))

from app.agents import HealthAgentRuntime
from app.config import _read_float_env, _read_int_env
from app.llm import OpenAICompatibleLLMClient, StructuredLLMResult
from app.models import PostMessageRequest, ToolResponse
from app.trace_logger import TraceLogger


class FakeStore:
    def __init__(self) -> None:
        self.tool_logs: list[dict[str, Any]] = []

    async def list_messages(self, thread_id: str, authorization: str | None = None) -> list[dict[str, Any]]:
        return [{"role": "user", "content": f"message {index}", "created_at": str(index)} for index in range(15)]

    async def get_thread(self, thread_id: str, authorization: str | None = None) -> dict[str, Any]:
        return {"id": thread_id, "summary": "用户想减脂，同时膝盖不舒服。"}

    async def create_tool_invocation(
        self,
        tool_name: str,
        status: str,
        request_data: dict[str, Any],
        response_data: dict[str, Any],
        authorization: str | None = None,
    ) -> None:
        self.tool_logs.append(
            {
                "tool_name": tool_name,
                "status": status,
                "request_data": request_data,
                "response_data": response_data,
            }
        )


class FakeTools:
    async def get_memory_summary(self, authorization: str | None = None) -> ToolResponse:
        return ToolResponse(ok=True, data={"memories": []}, human_readable="Loaded memories.", source="backend")

    async def load_current_plan(self, authorization: str | None = None) -> ToolResponse:
        return ToolResponse(ok=True, data={}, human_readable="Loaded plan.", source="backend")

    async def invoke(self, tool_name: str, **kwargs: Any) -> ToolResponse:
        if tool_name == "get_memory_summary":
            return await self.get_memory_summary(kwargs.get("authorization"))
        return ToolResponse(
            ok=False,
            data={"tool_name": tool_name},
            human_readable="Tool failed in test.",
            source="test",
            error_code="test_failure",
        )


class StrictArgumentTools(FakeTools):
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def invoke(self, tool_name: str, **kwargs: Any) -> ToolResponse:
        self.calls.append((tool_name, kwargs))
        if tool_name == "get_exercise_catalog" and kwargs:
            raise TypeError(f"get_exercise_catalog does not accept planner arguments: {kwargs}")
        return ToolResponse(
            ok=True,
            data={"tool_name": tool_name, "arguments": kwargs},
            human_readable=f"{tool_name} completed.",
            source="test",
        )


class LocationTools(FakeTools):
    async def invoke(self, tool_name: str, **kwargs: Any) -> ToolResponse:
        if tool_name == "geocode_location":
            return ToolResponse(
                ok=True,
                data={"latitude": 31.2, "longitude": 121.4},
                human_readable="Geocoded location.",
                source="amap",
            )
        if tool_name == "search_nearby_places":
            return ToolResponse(
                ok=True,
                data={"places": [{"name": "Test Gym"}]},
                human_readable="Searched nearby places.",
                source="amap",
            )
        return await super().invoke(tool_name, **kwargs)


class FakeLLM:
    def __init__(self, enabled: bool = True, data: dict[str, Any] | None = None, ok: bool = True) -> None:
        self.enabled = enabled
        self.data = data or {}
        self.ok = ok
        self.prompts: list[str] = []

    def is_enabled(self) -> bool:
        return self.enabled

    def generate_structured_with_metadata(self, system_prompt: str, user_prompt: str) -> StructuredLLMResult:
        self.prompts.append(user_prompt)
        return StructuredLLMResult(
            ok=self.ok,
            data=self.data,
            model_id="test-model",
            base_url="test-url",
            latency_ms=1,
            error_code=None if self.ok else "test_error",
            error_message=None if self.ok else "failed",
            fallback_used=not self.ok,
        )


class BadJsonMessage:
    content = "not json"


class BadJsonChoice:
    message = BadJsonMessage()


class BadJsonCompletions:
    @staticmethod
    def create(**kwargs: Any) -> Any:
        return type("Response", (), {"choices": [BadJsonChoice()]})()


class BadJsonClient:
    chat = type("Chat", (), {"completions": BadJsonCompletions()})()


def make_runtime(llm: FakeLLM | OpenAICompatibleLLMClient) -> HealthAgentRuntime:
    return HealthAgentRuntime(FakeStore(), FakeTools(), TraceLogger(), llm)  # type: ignore[arg-type]


class AgentRuntimeContractTests(unittest.IsolatedAsyncioTestCase):
    def test_invalid_numeric_env_uses_defaults(self) -> None:
        import os

        previous_timeout = os.environ.get("LLM_TIMEOUT")
        previous_tokens = os.environ.get("LLM_MAX_TOKENS")
        os.environ["LLM_TIMEOUT"] = "not-a-number"
        os.environ["LLM_MAX_TOKENS"] = "many"
        try:
            self.assertEqual(_read_float_env("LLM_TIMEOUT", 30), 30)
            self.assertEqual(_read_int_env("LLM_MAX_TOKENS", 1200), 1200)
        finally:
            if previous_timeout is None:
                os.environ.pop("LLM_TIMEOUT", None)
            else:
                os.environ["LLM_TIMEOUT"] = previous_timeout
            if previous_tokens is None:
                os.environ.pop("LLM_MAX_TOKENS", None)
            else:
                os.environ["LLM_MAX_TOKENS"] = previous_tokens

    async def test_disabled_llm_uses_degraded_keyword_intent(self) -> None:
        runtime = make_runtime(FakeLLM(enabled=False))
        intent, metadata, degraded_reason = await runtime._classify_intent(
            PostMessageRequest(text="帮我看看今天怎么练"),
            {"recent_messages": []},
        )

        self.assertEqual(degraded_reason, "llm_disabled")
        self.assertIsNone(metadata)
        self.assertIn(intent["intent"], {"daily_guidance", "health_answer"})

    async def test_intent_classifier_uses_recent_context(self) -> None:
        llm = FakeLLM(
            data={
                "intent": "plan_adjust",
                "confidence": 0.91,
                "referenced_context": ["previous_plan"],
                "missing_fields": [],
                "risk_flags": [],
                "should_clarify": False,
                "clarifying_question": "",
                "write_domain": "plan",
            }
        )
        runtime = make_runtime(llm)
        context = await runtime._load_conversation_context("thread-1", "按刚才那个改轻一点", None)
        intent, metadata, degraded_reason = await runtime._classify_intent(PostMessageRequest(text="按刚才那个改轻一点"), context)

        self.assertIsNone(degraded_reason)
        self.assertTrue(metadata.ok if metadata else False)
        self.assertEqual(intent["intent"], "plan_adjust")
        self.assertIn("message 14", llm.prompts[-1])
        self.assertNotIn("message 0", llm.prompts[-1])

    async def test_explicit_body_metric_overrides_stale_plan_clarification(self) -> None:
        llm = FakeLLM(
            data={
                "intent": "plan_generate",
                "confidence": 0.88,
                "referenced_context": ["recent_plan_generation_turn"],
                "missing_fields": ["goal"],
                "risk_flags": [],
                "should_clarify": True,
                "clarifying_question": "这份计划的目标更偏增肌、减脂还是力量提升？",
                "write_domain": "plan",
            }
        )
        runtime = make_runtime(llm)
        context = {
            "recent_messages": [
                {"role": "user", "content": "帮我生成一个训练计划"},
                {"role": "assistant", "content": "这份计划的目标更偏增肌、减脂还是力量提升？"},
            ]
        }

        intent, metadata, degraded_reason = await runtime._classify_intent(
            PostMessageRequest(text="我今天的体重是68kg，帮我记录"),
            context,
        )

        self.assertIsNone(degraded_reason)
        self.assertTrue(metadata and metadata.ok)
        self.assertEqual(intent["intent"], "body_metric_log")
        self.assertEqual(intent["write_domain"], "body_metric")
        self.assertEqual(intent["source"], "keyword_override")

    def test_contextual_plan_flow_does_not_capture_explicit_body_metric(self) -> None:
        runtime = make_runtime(FakeLLM())
        request = PostMessageRequest(text="我今天的体重是68kg，帮我记录")
        context = {
            "recent_messages": [
                {"role": "user", "content": "帮我生成一个训练计划"},
                {"role": "assistant", "content": "这份计划的目标更偏增肌、减脂还是力量提升？"},
            ]
        }
        fallback = runtime._fallback_intent_from_keywords(request.text)

        self.assertIsNone(runtime._contextual_plan_intent(request, context, fallback))

    def test_contextual_plan_flow_does_not_capture_exercise_recommendations(self) -> None:
        runtime = make_runtime(FakeLLM())
        request = PostMessageRequest(text="给我推荐一些练胸的动作")
        context = {
            "recent_messages": [
                {"role": "user", "content": "我今天想练胸，给我一些动作推荐"},
                {"role": "assistant", "content": "这份计划的目标更偏增肌、减脂还是力量提升？"},
                {"role": "user", "content": "增肌"},
                {"role": "assistant", "content": "收到，我先按“生成训练计划”理解，整理成了 1 条待确认卡片。"},
            ]
        }
        fallback = runtime._fallback_intent_from_keywords(request.text)

        self.assertEqual(fallback["intent"], "exercise_search")
        self.assertIsNone(fallback["write_domain"])
        self.assertIsNone(runtime._contextual_plan_intent(request, context, fallback))

    def test_dialogue_asks_body_metric_value_not_plan_goal(self) -> None:
        runtime = make_runtime(FakeLLM())
        intent = runtime._fallback_intent_from_keywords("我想要记录今日体重")
        planner = runtime._fallback_planner_from_intent(intent, PostMessageRequest(text="我想要记录今日体重"))

        decision = runtime._decide_dialogue_turn(
            PostMessageRequest(text="我想要记录今日体重"),
            {"recent_messages": []},
            intent,
            planner,
        )

        self.assertEqual(decision["mode"], "clarify")
        self.assertIn("具体数值", decision["question"])
        self.assertNotIn("增肌", decision["question"])

    async def test_exercise_recommendation_overrides_plan_llm_result(self) -> None:
        llm = FakeLLM(
            data={
                "intent": "plan_generate",
                "confidence": 0.88,
                "referenced_context": ["recent_plan_generation_turn"],
                "missing_fields": [],
                "risk_flags": [],
                "should_clarify": False,
                "clarifying_question": "",
                "write_domain": "plan",
            }
        )
        runtime = make_runtime(llm)
        context = {
            "recent_messages": [
                {"role": "assistant", "content": "收到，我先按“生成训练计划”理解，整理成了 1 条待确认卡片。"},
            ]
        }

        intent, metadata, degraded_reason = await runtime._classify_intent(
            PostMessageRequest(text="给我推荐一些练胸的动作"),
            context,
        )

        self.assertIsNone(degraded_reason)
        self.assertTrue(metadata and metadata.ok)
        self.assertEqual(intent["intent"], "exercise_search")
        self.assertIsNone(intent["write_domain"])
        self.assertEqual(intent["source"], "keyword_read_override")

    async def test_exercise_recommendation_planner_stays_read_only(self) -> None:
        llm = FakeLLM(
            data={
                "action": "propose",
                "tools": [{"name": "create_action_proposal", "arguments": {"write_domain": "plan"}, "purpose": "bad"}],
                "requires_proposal": True,
                "write_domain": "plan",
                "response_style": "normal",
                "missing_fields": [],
                "risk_level": "medium",
            }
        )
        runtime = make_runtime(llm)
        request = PostMessageRequest(text="我今天想练胸，给我一些动作推荐")
        intent = runtime._fallback_intent_from_keywords(request.text)

        planner, metadata, degraded_reason = await runtime._plan_next_steps(request, {"recent_messages": []}, intent, None)

        self.assertIsNone(degraded_reason)
        self.assertTrue(metadata and metadata.ok)
        self.assertEqual(planner["action"], "answer")
        self.assertFalse(planner["requires_proposal"])
        self.assertIsNone(planner["write_domain"])
        self.assertEqual([tool["name"] for tool in planner["tools"]], ["get_exercise_catalog"])

    async def test_exercise_recommendation_clears_contaminated_write_domain(self) -> None:
        llm = FakeLLM(
            data={
                "intent": "exercise_search",
                "confidence": 0.87,
                "referenced_context": ["recent_plan_generation_turn"],
                "missing_fields": [],
                "risk_flags": [],
                "should_clarify": False,
                "clarifying_question": "",
                "write_domain": "plan",
            }
        )
        runtime = make_runtime(llm)

        intent, metadata, degraded_reason = await runtime._classify_intent(
            PostMessageRequest(text="给我推荐一些练胸的动作"),
            {"recent_messages": []},
        )

        self.assertIsNone(degraded_reason)
        self.assertTrue(metadata and metadata.ok)
        self.assertEqual(intent["intent"], "exercise_search")
        self.assertIsNone(intent["write_domain"])
        self.assertEqual(intent["source"], "keyword_read_override")

    async def test_exercise_recommendation_planner_clears_proposal_flags_on_answer(self) -> None:
        llm = FakeLLM(
            data={
                "action": "answer",
                "tools": [
                    {"name": "get_exercise_catalog", "arguments": {}, "purpose": "good"},
                    {"name": "create_action_proposal", "arguments": {"write_domain": "plan"}, "purpose": "bad"},
                ],
                "requires_proposal": True,
                "write_domain": "plan",
                "response_style": "normal",
                "missing_fields": [],
                "risk_level": "medium",
            }
        )
        runtime = make_runtime(llm)
        request = PostMessageRequest(text="给我推荐一些练胸的动作")
        intent = runtime._fallback_intent_from_keywords(request.text)

        planner, metadata, degraded_reason = await runtime._plan_next_steps(request, {"recent_messages": []}, intent, None)
        dialogue = runtime._decide_dialogue_turn(request, {"recent_messages": []}, intent, planner)

        self.assertIsNone(degraded_reason)
        self.assertTrue(metadata and metadata.ok)
        self.assertEqual(planner["action"], "answer")
        self.assertFalse(planner["requires_proposal"])
        self.assertIsNone(planner["write_domain"])
        self.assertEqual([tool["name"] for tool in planner["tools"]], ["get_exercise_catalog"])
        self.assertEqual(dialogue["mode"], "answer")
        self.assertNotIn("create_action_proposal", [tool["name"] for tool in dialogue["planner"]["tools"]])

    async def test_low_confidence_classifier_clarifies(self) -> None:
        runtime = make_runtime(FakeLLM(data={"intent": "unclear", "confidence": 0.2}))
        intent, _, _ = await runtime._classify_intent(PostMessageRequest(text="那个呢"), {"recent_messages": []})

        self.assertTrue(intent["should_clarify"])
        self.assertTrue(intent["clarifying_question"])

    async def test_planner_filters_non_whitelisted_tools(self) -> None:
        runtime = make_runtime(FakeLLM())
        planner = runtime._normalize_planner_decision(
            {
                "action": "answer",
                "tools": [
                    {"name": "delete_database", "arguments": {}, "purpose": "bad"},
                    {"name": "get_memory_summary", "arguments": {}, "purpose": "good"},
                ],
            },
            {"action": "answer", "tools": [], "risk_level": "low"},
        )

        self.assertEqual([tool["name"] for tool in planner["tools"]], ["get_memory_summary"])

    def test_classifier_normalizes_fitness_domain_for_plan_generation(self) -> None:
        runtime = make_runtime(FakeLLM())
        intent = runtime._normalize_intent_result(
            {
                "intent": "plan_generate",
                "confidence": 0.9,
                "write_domain": "fitness",
                "should_clarify": False,
            },
            {"intent": "plan_generate", "confidence": 0.6, "write_domain": "plan"},
        )

        self.assertEqual(intent["write_domain"], "plan")

    def test_planner_appends_missing_proposal_tool_when_required(self) -> None:
        runtime = make_runtime(FakeLLM())
        planner = runtime._normalize_planner_decision(
            {
                "action": "propose",
                "tools": [
                    {"name": "get_coach_summary", "arguments": {}, "purpose": "read coach"},
                    {"name": "load_current_plan", "arguments": {}, "purpose": "read plan"},
                    {"name": "get_memory_summary", "arguments": {}, "purpose": "read memory"},
                    {"name": "get_exercise_catalog", "arguments": {}, "purpose": "read exercises"},
                ],
                "requires_proposal": True,
                "write_domain": "plan",
            },
            {"action": "propose", "tools": [], "requires_proposal": True, "write_domain": "plan", "risk_level": "medium"},
        )

        tool_names = [tool["name"] for tool in planner["tools"]]
        self.assertEqual(len(tool_names), 4)
        self.assertEqual(tool_names[-1], "create_action_proposal")
        self.assertNotIn("get_exercise_catalog", tool_names)

    async def test_virtual_proposal_tool_generates_proposals_without_execution(self) -> None:
        store = FakeStore()
        runtime = HealthAgentRuntime(store, FakeTools(), TraceLogger(), FakeLLM())  # type: ignore[arg-type]
        observations, tool_events, proposals, warnings = await runtime._execute_planner_tools(
            "thread-1",
            "run-1",
            PostMessageRequest(text="记住我不喜欢跑步"),
            {
                "tools": [
                    {
                        "name": "create_action_proposal",
                        "arguments": {"write_domain": "memory"},
                        "purpose": "memory proposal",
                    }
                ],
                "write_domain": "memory",
            },
            None,
        )

        self.assertEqual(warnings, [])
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0]["actionType"], "create_coaching_memory")
        self.assertTrue(any(event.tool_name == "create_action_proposal" for event in tool_events))
        self.assertTrue(store.tool_logs)
        self.assertTrue(any(item["tool"] == "create_action_proposal" for item in observations))

    async def test_planner_tool_arguments_are_filtered_before_execution(self) -> None:
        store = FakeStore()
        tools = StrictArgumentTools()
        runtime = HealthAgentRuntime(store, tools, TraceLogger(), FakeLLM())  # type: ignore[arg-type]
        observations, _tool_events, proposals, warnings = await runtime._execute_planner_tools(
            "thread-1",
            "run-1",
            PostMessageRequest(text="推荐一个胸部训练动作"),
            {
                "tools": [
                    {
                        "name": "get_exercise_catalog",
                        "arguments": {"muscle_group": "chest", "tags": ["push"]},
                        "purpose": "read filtered exercises",
                    }
                ],
                "write_domain": None,
            },
            None,
        )

        self.assertEqual(proposals, [])
        self.assertEqual(warnings, [])
        self.assertEqual(tools.calls, [("get_exercise_catalog", {})])
        self.assertTrue(observations[0]["ok"])

    async def test_proposal_tool_normalizes_tool_domain_argument_at_execution(self) -> None:
        store = FakeStore()
        runtime = HealthAgentRuntime(store, FakeTools(), TraceLogger(), FakeLLM())  # type: ignore[arg-type]
        _observations, _tool_events, proposals, warnings = await runtime._execute_planner_tools(
            "thread-1",
            "run-1",
            PostMessageRequest(text="帮我生成一个一周三练的三分化训练计划吧"),
            {
                "tools": [
                    {
                        "name": "create_action_proposal",
                        "arguments": {"write_domain": "fitness"},
                        "purpose": "plan proposal",
                    }
                ],
                "write_domain": "plan",
            },
            None,
        )

        self.assertEqual(warnings, [])
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0]["actionType"], "generate_plan")

    def test_dialogue_keeps_casual_training_chat_answer_only(self) -> None:
        runtime = make_runtime(FakeLLM())
        intent = {
            "intent": "health_answer",
            "confidence": 0.86,
            "should_clarify": False,
            "write_domain": None,
            "risk_flags": [],
        }
        planner = {"action": "answer", "tools": [], "requires_proposal": False, "write_domain": None, "risk_level": "low"}

        decision = runtime._decide_dialogue_turn(
            PostMessageRequest(text="力量训练后第二天酸痛还能练吗？"),
            {"recent_messages": []},
            intent,
            planner,
        )

        self.assertEqual(decision["mode"], "answer")
        self.assertFalse(decision["planner"]["requires_proposal"])
        self.assertNotIn("create_action_proposal", [tool["name"] for tool in decision["planner"]["tools"]])

    def test_dialogue_confirms_ambiguous_operation_before_tools(self) -> None:
        runtime = make_runtime(FakeLLM())
        intent = {
            "intent": "workout_log",
            "confidence": 0.72,
            "should_clarify": False,
            "write_domain": "workout_log",
            "risk_flags": [],
        }
        planner = {
            "action": "propose",
            "tools": [{"name": "create_action_proposal", "arguments": {"write_domain": "workout_log"}, "purpose": "Create log."}],
            "requires_proposal": True,
            "write_domain": "workout_log",
            "risk_level": "low",
        }

        decision = runtime._decide_dialogue_turn(
            PostMessageRequest(text="把我的训练记录保存一下"),
            {"recent_messages": []},
            intent,
            planner,
        )

        self.assertEqual(decision["mode"], "confirm_operation")
        self.assertEqual(decision["planner"]["tools"], [])
        self.assertFalse(decision["planner"]["requires_proposal"])
        self.assertIn("训练日志", decision["question"])

    def test_dialogue_clarifies_plan_generation_missing_goal(self) -> None:
        runtime = make_runtime(FakeLLM())
        intent = {
            "intent": "plan_generate",
            "confidence": 0.9,
            "should_clarify": False,
            "write_domain": "plan",
            "missing_fields": [],
            "risk_flags": [],
        }
        planner = {
            "action": "propose",
            "tools": [{"name": "create_action_proposal", "arguments": {"write_domain": "plan"}, "purpose": "Create plan."}],
            "requires_proposal": True,
            "write_domain": "plan",
            "risk_level": "medium",
        }

        decision = runtime._decide_dialogue_turn(
            PostMessageRequest(text="帮我生成一个训练计划"),
            {"recent_messages": []},
            intent,
            planner,
        )

        self.assertEqual(decision["mode"], "clarify")
        self.assertEqual(decision["planner"]["tools"], [])
        self.assertIn("目标", decision["question"])

    def test_dialogue_uses_recent_plan_answers_before_asking_again(self) -> None:
        runtime = make_runtime(FakeLLM())
        request = PostMessageRequest(text="增肌为目标")
        conversation_context = {
            "recent_messages": [
                {"role": "user", "content": "给我生成一个练胸日的计划"},
                {"role": "assistant", "content": "这份计划更偏增肌、减脂还是力量提升？"},
                {"role": "user", "content": "练胸为目标"},
                {"role": "assistant", "content": "这份计划更偏增肌、减脂还是力量提升？"},
                {"role": "user", "content": "增肌为目标"},
            ]
        }
        fallback = runtime._fallback_intent_from_keywords(request.text)
        intent = runtime._contextual_plan_intent(request, conversation_context, fallback)
        assert intent is not None
        planner = runtime._fallback_planner_from_intent(intent, request)

        decision = runtime._decide_dialogue_turn(request, conversation_context, intent, planner)

        self.assertEqual(decision["mode"], "propose")
        self.assertTrue(decision["planner"]["requires_proposal"])
        self.assertIn("create_action_proposal", [tool["name"] for tool in decision["planner"]["tools"]])

    async def test_plan_proposal_uses_recent_plan_slots_for_followup_answer(self) -> None:
        store = FakeStore()
        runtime = HealthAgentRuntime(store, FakeTools(), TraceLogger(), FakeLLM())  # type: ignore[arg-type]
        conversation_context = {
            "recent_messages": [
                {"role": "user", "content": "给我生成一个练胸日的计划"},
                {"role": "assistant", "content": "这份计划更偏增肌、减脂还是力量提升？"},
                {"role": "user", "content": "增肌为目标"},
            ]
        }

        _observations, _tool_events, proposals, warnings = await runtime._execute_planner_tools(
            "thread-1",
            "run-1",
            PostMessageRequest(text="增肌为目标"),
            {
                "tools": [{"name": "create_action_proposal", "arguments": {"write_domain": "plan"}, "purpose": "Create plan."}],
                "write_domain": "plan",
            },
            None,
            conversation_context,
        )

        self.assertEqual(warnings, [])
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0]["actionType"], "generate_plan")
        self.assertEqual(proposals[0]["payload"]["goal"], "muscle_gain")
        self.assertTrue(proposals[0]["payload"].get("days"))

    def test_delete_all_plan_creates_delete_proposals_for_each_day(self) -> None:
        runtime = make_runtime(FakeLLM())
        current_plan = {
            "plan": {
                "id": "plan-1",
                "title": "Current plan",
                "version": 1,
                "updatedAt": "2026-05-24T08:00:00.000Z",
            },
            "days": [
                {"id": "day-1", "dayLabel": "周一", "focus": "上肢", "duration": "45 分钟"},
                {"id": "day-2", "dayLabel": "周三", "focus": "下肢", "duration": "45 分钟"},
            ],
        }

        proposals = runtime._plan_proposals("我想要删除所有的计划", {"current_plan": current_plan})

        self.assertEqual([proposal["actionType"] for proposal in proposals], ["delete_plan_day", "delete_plan_day"])
        self.assertEqual([proposal["payload"]["dayId"] for proposal in proposals], ["day-1", "day-2"])
        self.assertTrue(all("expectedDayId" not in proposal for proposal in proposals))

    def test_delete_all_plan_is_ready_without_target_day(self) -> None:
        runtime = make_runtime(FakeLLM())
        intent = runtime._fallback_intent_from_keywords("我想要删除所有的计划")
        planner = runtime._fallback_planner_from_intent(intent, PostMessageRequest(text="我想要删除所有的计划"))

        decision = runtime._decide_dialogue_turn(
            PostMessageRequest(text="我想要删除所有的计划"),
            {"recent_messages": []},
            intent,
            planner,
        )

        self.assertEqual(decision["mode"], "propose")
        self.assertIn("create_action_proposal", [tool["name"] for tool in decision["planner"]["tools"]])

    async def test_diet_log_generates_persistable_diet_proposal(self) -> None:
        store = FakeStore()
        runtime = HealthAgentRuntime(store, FakeTools(), TraceLogger(), FakeLLM())  # type: ignore[arg-type]
        request = PostMessageRequest(text="午饭吃了鸡胸肉、米饭、青菜，大概650卡，蛋白45g")
        intent = runtime._fallback_intent_from_keywords(request.text)
        planner = runtime._fallback_planner_from_intent(intent, request)

        _observations, _tool_events, proposals, warnings = await runtime._execute_planner_tools(
            "thread-1",
            "run-1",
            request,
            planner,
            None,
        )

        self.assertEqual(intent["intent"], "diet_log")
        self.assertEqual(intent["write_domain"], "diet_log")
        self.assertEqual(warnings, [])
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0]["actionType"], "create_diet_log")
        self.assertEqual(proposals[0]["payload"]["mealType"], "lunch")
        self.assertEqual(proposals[0]["payload"]["totalCalorie"], 650)
        self.assertEqual(proposals[0]["payload"]["proteinGrams"], 45)

    def test_dialogue_allows_clear_workout_log_proposal(self) -> None:
        runtime = make_runtime(FakeLLM())
        intent = {
            "intent": "workout_log",
            "confidence": 0.93,
            "should_clarify": False,
            "write_domain": "workout_log",
            "risk_flags": [],
        }
        planner = {
            "action": "propose",
            "tools": [{"name": "create_action_proposal", "arguments": {"write_domain": "workout_log"}, "purpose": "Create log."}],
            "requires_proposal": True,
            "write_domain": "workout_log",
            "risk_level": "low",
        }

        decision = runtime._decide_dialogue_turn(
            PostMessageRequest(text="记录一下今天练了45分钟上肢，RPE 8"),
            {"recent_messages": []},
            intent,
            planner,
        )

        self.assertEqual(decision["mode"], "propose")
        self.assertTrue(decision["planner"]["requires_proposal"])
        self.assertIn("create_action_proposal", [tool["name"] for tool in decision["planner"]["tools"]])

    def test_dialogue_asks_safety_question_before_high_risk_plan(self) -> None:
        runtime = make_runtime(FakeLLM())
        intent = {
            "intent": "plan_generate",
            "confidence": 0.78,
            "should_clarify": False,
            "write_domain": "plan",
            "risk_flags": ["knee_pain"],
        }
        planner = {
            "action": "propose",
            "tools": [{"name": "create_action_proposal", "arguments": {"write_domain": "plan"}, "purpose": "Create plan."}],
            "requires_proposal": True,
            "write_domain": "plan",
            "risk_level": "high",
        }

        decision = runtime._decide_dialogue_turn(
            PostMessageRequest(text="我膝盖疼但想冲一下跑步计划"),
            {"recent_messages": []},
            intent,
            planner,
        )

        self.assertEqual(decision["mode"], "clarify")
        self.assertEqual(decision["planner"]["tools"], [])
        self.assertEqual(decision["planner"]["dialogue_reason"], "safety_first")

    def test_dialogue_downgrades_implicit_memory_to_answer_candidate(self) -> None:
        runtime = make_runtime(FakeLLM())
        intent = {
            "intent": "memory_save",
            "confidence": 0.72,
            "should_clarify": False,
            "write_domain": "memory",
            "risk_flags": [],
        }
        planner = {
            "action": "propose",
            "tools": [{"name": "create_action_proposal", "arguments": {"write_domain": "memory"}, "purpose": "Create memory."}],
            "requires_proposal": True,
            "write_domain": "memory",
            "risk_level": "low",
        }

        decision = runtime._decide_dialogue_turn(
            PostMessageRequest(text="我不喜欢早上练，晚上状态更好"),
            {"recent_messages": []},
            intent,
            planner,
        )

        self.assertEqual(decision["mode"], "answer")
        self.assertIsNone(decision["intent"]["write_domain"])
        self.assertNotIn("create_action_proposal", [tool["name"] for tool in decision["planner"]["tools"]])
        self.assertTrue(decision["planner"]["implicit_memory_candidate"])

    async def test_dialogue_proposal_copy_uses_training_buddy_confirmation(self) -> None:
        runtime = make_runtime(FakeLLM(enabled=False))
        content, reasoning, next_actions, _metadata, degraded_reason = await runtime._compose_dialogue_response(
            "propose",
            PostMessageRequest(text="记录一下今天练了45分钟上肢，RPE 8"),
            {"recent_messages": []},
            {"intent": "workout_log", "write_domain": "workout_log"},
            {"action": "propose", "write_domain": "workout_log"},
            {"operation_label": "记录训练日志"},
            proposals=[{"riskLevel": "low"}],
            degraded_reason=None,
        )

        self.assertEqual(degraded_reason, "llm_disabled")
        self.assertIn("待确认卡片", content)
        self.assertIn("确认后", content)
        self.assertNotIn("修改数据", content)
        self.assertTrue(reasoning)
        self.assertTrue(next_actions)

    async def test_planner_can_chain_geocode_to_nearby_search_in_second_iteration(self) -> None:
        store = FakeStore()
        runtime = HealthAgentRuntime(store, LocationTools(), TraceLogger(), FakeLLM())  # type: ignore[arg-type]
        observations, tool_events, proposals, warnings = await runtime._execute_planner_tools(
            "thread-1",
            "run-1",
            PostMessageRequest(text="帮我找附近健身房", location_hint="上海静安寺"),
            {
                "tools": [{"name": "geocode_location", "arguments": {"location": "上海静安寺"}, "purpose": "resolve"}],
                "write_domain": None,
            },
            None,
        )

        self.assertEqual(proposals, [])
        self.assertEqual(warnings, [])
        self.assertIn("geocode_location", [event.tool_name for event in tool_events])
        self.assertIn("search_nearby_places", [event.tool_name for event in tool_events])
        self.assertTrue(any(item["tool"] == "search_nearby_places" for item in observations))


class LLMClientMetadataTests(unittest.TestCase):
    def test_structured_metadata_reports_json_parse_failure(self) -> None:
        client = OpenAICompatibleLLMClient()
        client._enabled = True
        client._client = BadJsonClient()

        result = client.generate_structured_with_metadata("Return JSON.", "Return JSON.")

        self.assertFalse(result.ok)
        self.assertEqual(result.error_code, "json_parse_error")
        self.assertTrue(result.fallback_used)


class AgentCoachingPersonalizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_coaching_constraints_vary_by_user_request_and_memory(self) -> None:
        runtime = make_runtime(FakeLLM(enabled=False))
        summary = {
            "completion": {"completionRate": 50},
            "currentPlan": {"days": []},
            "recentDailyCheckins": [{"sleepHours": 6, "fatigueLevel": "high"}],
            "recentWorkoutLogs": [{}],
            "memorySummary": {
                "activeMemories": [
                    {
                        "id": "memory-1",
                        "category": "equipment_constraint",
                        "summary": "User trains at home with adjustable dumbbells.",
                        "confidence": 90,
                    },
                    {
                        "id": "memory-2",
                        "category": "injury_or_pain",
                        "summary": "Knee pain increases after running.",
                        "confidence": 90,
                    },
                ]
            },
        }

        constraints = runtime._build_programming_constraints("weekly_review", "安排4天，每次30分钟，增肌", summary)
        generation = runtime._fallback_coaching_generation("weekly_review", constraints)

        self.assertEqual(constraints["days_per_week"], 4)
        self.assertEqual(constraints["session_duration_min"], 30)
        self.assertEqual(constraints["goal"], "muscle_gain")
        self.assertTrue(constraints["recovery_mode"])
        self.assertEqual(len(generation["training_plan_draft"]["days"]), 4)
        self.assertIn("dumbbells", constraints["equipment"])

    async def test_invalid_llm_coaching_draft_falls_back_to_valid_generation(self) -> None:
        llm = FakeLLM(
            data={
                "training_plan_draft": {"title": "Bad", "goal": "fat_loss", "days": []},
                "nutrition_draft": {"targetCalorie": 800, "totalCalorie": 800},
                "coaching_review_draft": {"title": "Bad", "summary": "Bad"},
            }
        )
        runtime = make_runtime(llm)
        generation, steps, _constraints, warnings = await runtime._generate_coaching_generation(
            "weekly_review",
            "下周计划",
            {"completion": {}, "recentDailyCheckins": [], "currentPlan": {"days": []}},
            None,
        )

        self.assertTrue(steps)
        self.assertGreaterEqual(generation["nutrition_draft"]["targetCalorie"], 1200)
        self.assertTrue(generation["training_plan_draft"]["days"])
        self.assertTrue(any("fallback_used_after_blockers" in warning for warning in warnings))

    async def test_memory_extraction_creates_candidate_and_conflict_proposals_only(self) -> None:
        runtime = make_runtime(FakeLLM(enabled=False))
        candidate = runtime._memory_extraction_proposals("请记住我不喜欢跑步", "好的", {"memory_summary": {"activeMemories": []}})

        self.assertEqual(len(candidate), 1)
        self.assertEqual(candidate[0]["actionType"], "create_coaching_memory")
        self.assertEqual(candidate[0]["payload"]["conflictStatus"], "candidate")

        conflict = runtime._memory_extraction_proposals(
            "请记住我现在喜欢跑步",
            "好的",
            {
                "memory_summary": {
                    "activeMemories": [
                        {
                            "id": "memory-old",
                            "category": "training_preference",
                            "summary": "我不喜欢跑步",
                        }
                    ]
                }
            },
        )

        self.assertEqual(conflict[0]["actionType"], "update_coaching_memory")
        self.assertEqual(conflict[0]["payload"]["memoryId"], "memory-old")


    async def test_failed_llm_coaching_generation_is_observable(self) -> None:
        runtime = make_runtime(FakeLLM(ok=False))
        generation, steps, _constraints, warnings = await runtime._generate_coaching_generation(
            "weekly_review",
            "next week plan",
            {"completion": {}, "recentDailyCheckins": [], "currentPlan": {"days": []}},
            None,
        )

        self.assertTrue(generation["training_plan_draft"]["days"])
        self.assertTrue(any(warning.startswith("llm_generation_failed") for warning in warnings))
        self.assertTrue(any(step.step_type == "llm_call" and step.payload.get("ok") is False for step in steps))

    async def test_memory_extraction_tracks_source_message_id(self) -> None:
        runtime = make_runtime(FakeLLM(enabled=False))
        candidate = runtime._memory_extraction_proposals(
            "remember I dislike running",
            "Got it.",
            {"memory_summary": {"activeMemories": []}},
            "user-message-1",
        )

        self.assertEqual(candidate[0]["actionType"], "create_coaching_memory")
        self.assertEqual(candidate[0]["payload"]["sourceMessageId"], "user-message-1")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from typing import Any


FITNESS_ROOT = Path(__file__).resolve().parents[2]
AGENT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENT_ROOT))

from app.agents import HealthAgentRuntime
from app.llm import StructuredLLMResult
from app.models import PostMessageRequest, ToolResponse
from app.trace_logger import TraceLogger


EVAL_FIXTURE = FITNESS_ROOT / "evals" / "agent-golden-conversations.json"


class EvalStore:
    def __init__(self, case: dict[str, Any] | None = None) -> None:
        self.case = case or {}
        self.tool_logs: list[dict[str, Any]] = []

    async def list_messages(self, thread_id: str, authorization: str | None = None) -> list[dict[str, Any]]:
        return list(self.case.get("messages") or [])

    async def get_thread(self, thread_id: str, authorization: str | None = None) -> dict[str, Any]:
        return {"id": thread_id, "summary": str(self.case.get("thread_summary") or "")}

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


class EvalTools:
    def __init__(self, case: dict[str, Any] | None = None) -> None:
        self.case = case or {}

    async def get_memory_summary(self, authorization: str | None = None) -> ToolResponse:
        return ToolResponse(
            ok=True,
            data=self.case.get("memory_summary") if isinstance(self.case.get("memory_summary"), dict) else {"activeMemories": []},
            human_readable="Loaded memory summary for eval.",
            source="eval",
        )

    async def invoke(self, tool_name: str, **kwargs: Any) -> ToolResponse:
        return ToolResponse(
            ok=True,
            data={"tool_name": tool_name, "arguments": kwargs},
            human_readable=f"{tool_name} completed in eval.",
            source="eval",
        )


class ScriptedEvalLLM:
    def __init__(self, case: dict[str, Any], ok: bool = True) -> None:
        self.case = case
        self.ok = ok

    def is_enabled(self) -> bool:
        return True

    def generate_structured_with_metadata(self, system_prompt: str, user_prompt: str) -> StructuredLLMResult:
        if not self.ok:
            return StructuredLLMResult(
                ok=False,
                data={},
                model_id="eval-model",
                base_url="eval",
                latency_ms=1,
                error_code="eval_llm_failure",
                error_message="scripted failure",
                fallback_used=True,
            )
        data = self.case["classifier_result"] if "classify user intent" in system_prompt else self.case["planner_result"]
        return StructuredLLMResult(
            ok=True,
            data=data,
            model_id="eval-model",
            base_url="eval",
            latency_ms=1,
            error_code=None,
            error_message=None,
            fallback_used=False,
        )


class DisabledEvalLLM:
    def is_enabled(self) -> bool:
        return False


def load_eval_cases() -> list[dict[str, Any]]:
    return list(json.loads(EVAL_FIXTURE.read_text(encoding="utf-8"))["cases"])


class AgentQualityGateTests(unittest.IsolatedAsyncioTestCase):
    def test_golden_fixture_has_ci_gate_metadata(self) -> None:
        fixture = json.loads(EVAL_FIXTURE.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(fixture["cases"]), fixture["thresholds"]["minimum_cases"])
        self.assertEqual(fixture["thresholds"]["maximum_forbidden_tool_count"], 0)

    async def test_golden_conversations_hold_intent_and_planner_contracts(self) -> None:
        for case in load_eval_cases():
            with self.subTest(case=case["id"]):
                runtime = HealthAgentRuntime(EvalStore(case), EvalTools(case), TraceLogger(), ScriptedEvalLLM(case))  # type: ignore[arg-type]
                request = PostMessageRequest(**case["request"])
                context = await runtime._load_conversation_context("eval-thread", request.text, None)
                intent, intent_llm, degraded_reason = await runtime._classify_intent(request, context)
                planner, planner_llm, planner_degraded_reason = await runtime._plan_next_steps(
                    request,
                    context,
                    intent,
                    degraded_reason,
                )
                expected = case["expected"]

                self.assertIsNone(degraded_reason)
                self.assertIsNone(planner_degraded_reason)
                deterministic_sources = {
                    "keyword_read_fast_path",
                    "modern_intent_router",
                    "modern_context_route",
                    "contextual_plan_flow",
                }
                if intent.get("source") in deterministic_sources:
                    self.assertIsNone(intent_llm)
                if intent_llm is not None:
                    self.assertTrue(intent_llm.ok)
                if planner_llm is not None:
                    self.assertTrue(planner_llm and planner_llm.ok)
                self.assertTrue(intent.get("intent"))
                self.assertGreaterEqual(float(intent.get("confidence") or 0), 0.3)
                self.assertIn(planner["action"], {"answer", "clarify", "propose", "legacy_route"})
                self.assertIsInstance(planner["requires_proposal"], bool)
                self.assertIn(planner["risk_level"], {"low", "medium", "high"})
                self.assertLessEqual(len(planner["tools"]), 4)

                tool_names = [tool["name"] for tool in planner["tools"]]
                for tool_name in [*expected["forbidden_tools"], "execute_agent_command", "delete_database"]:
                    if tool_name == "create_action_proposal" and planner["requires_proposal"]:
                        continue
                    self.assertNotIn(tool_name, tool_names)
                for tool_name in tool_names:
                    self.assertIn(tool_name, runtime.PLANNER_TOOL_WHITELIST)
                if planner["requires_proposal"]:
                    self.assertTrue(planner.get("write_domain"))
                    self.assertIn("create_action_proposal", tool_names)

                if expected.get("dialogue_mode"):
                    dialogue = runtime._decide_dialogue_turn(request, context, intent, planner)
                    self.assertIn(dialogue["mode"], {"answer", "clarify", "confirm_operation", "propose"})
                    dialogue_tool_names = [tool["name"] for tool in dialogue["planner"]["tools"]]
                    for tool_name in expected.get("dialogue_forbidden_tools", []):
                        self.assertNotIn(tool_name, dialogue_tool_names)

    async def test_llm_failure_is_visible_degraded_mode(self) -> None:
        case = load_eval_cases()[0]
        runtime = HealthAgentRuntime(EvalStore(case), EvalTools(case), TraceLogger(), ScriptedEvalLLM(case, ok=False))  # type: ignore[arg-type]
        request = PostMessageRequest(**case["request"])
        context = await runtime._load_conversation_context("eval-thread", request.text, None)
        intent, intent_llm, degraded_reason = await runtime._classify_intent(request, context)
        planner, planner_llm, planner_degraded_reason = await runtime._plan_next_steps(request, context, intent, degraded_reason)

        self.assertEqual(degraded_reason, "eval_llm_failure")
        self.assertTrue(intent_llm and not intent_llm.ok)
        self.assertIsNone(planner_llm)
        self.assertEqual(planner_degraded_reason, "eval_llm_failure")
        self.assertIn(intent["source"], {"keyword_fallback", "keyword_override"})
        self.assertEqual(planner["source"], "fallback_planner")

    async def test_disabled_llm_uses_degraded_fallback_path(self) -> None:
        case = load_eval_cases()[8]
        runtime = HealthAgentRuntime(EvalStore(case), EvalTools(case), TraceLogger(), DisabledEvalLLM())  # type: ignore[arg-type]
        request = PostMessageRequest(**case["request"])
        context = await runtime._load_conversation_context("eval-thread", request.text, None)
        intent, intent_llm, degraded_reason = await runtime._classify_intent(request, context)
        planner, planner_llm, planner_degraded_reason = await runtime._plan_next_steps(request, context, intent, degraded_reason)

        self.assertIn(degraded_reason, {None, "llm_disabled"})
        self.assertIn(planner_degraded_reason, {None, "llm_disabled"})
        self.assertIsNone(intent_llm)
        self.assertIsNone(planner_llm)
        self.assertIn(intent["source"], {"keyword_fallback", "keyword_override"})
        self.assertEqual(planner["source"], "fallback_planner")

    def test_clarify_planner_does_not_restore_fallback_write_tools(self) -> None:
        case = next(item for item in load_eval_cases() if item["id"] == "ambiguous-followup-clarify")
        runtime = HealthAgentRuntime(EvalStore(case), EvalTools(case), TraceLogger(), ScriptedEvalLLM(case))  # type: ignore[arg-type]
        planner = runtime._normalize_planner_decision(
            case["planner_result"],
            {
                "action": "propose",
                "tools": [{"name": "create_action_proposal", "arguments": {"write_domain": "plan"}, "purpose": "fallback"}],
                "requires_proposal": True,
                "write_domain": "plan",
                "risk_level": "medium",
            },
        )

        self.assertEqual(planner["action"], "clarify")
        self.assertEqual(planner["tools"], [])
        self.assertFalse(planner["requires_proposal"])

    def test_plan_and_diet_quality_rubric_blocks_unsafe_generation(self) -> None:
        runtime = HealthAgentRuntime(EvalStore(), EvalTools(), TraceLogger(), DisabledEvalLLM())  # type: ignore[arg-type]
        blockers, warnings = runtime._validate_coaching_generation(
            {
                "training_plan_draft": {"days": [{"dayLabel": "Day 1", "focus": "", "exercises": []}]},
                "nutrition_draft": {"targetCalorie": 800, "totalCalorie": 800},
                "coaching_review_draft": {},
            }
        )

        self.assertIn("training_day_missing_focus_or_exercises", blockers)
        self.assertIn("unsafe_diet_calories", blockers)
        self.assertIn("missing_nutrition_tips", warnings)


if __name__ == "__main__":
    unittest.main()

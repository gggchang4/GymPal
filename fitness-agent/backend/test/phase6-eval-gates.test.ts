import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(__dirname, "..", "..");

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("Phase 6 golden eval fixture is present and strict enough for CI", () => {
  const fixture = readJson(resolve(repoRoot, "docs", "evals", "remediation-golden-conversations.json"));

  assert.equal(fixture.version, 1);
  assert.ok(fixture.thresholds.minimum_cases >= 30);
  assert.equal(fixture.thresholds.minimum_intent_accuracy, 1);
  assert.equal(fixture.thresholds.minimum_required_tool_recall, 1);
  assert.equal(fixture.thresholds.maximum_forbidden_tool_count, 0);
  assert.ok(fixture.cases.length >= fixture.thresholds.minimum_cases);

  const ids = new Set<string>();
  for (const item of fixture.cases) {
    assert.equal(typeof item.id, "string");
    assert.ok(!ids.has(item.id), `duplicate eval case id ${item.id}`);
    ids.add(item.id);
    assert.equal(typeof item.request.text, "string", `${item.id} should include request text`);
    assert.equal(typeof item.classifier_result.intent, "string", `${item.id} should include classifier intent`);
    assert.equal(typeof item.planner_result.action, "string", `${item.id} should include planner action`);
    assert.ok(Array.isArray(item.expected.required_tools), `${item.id} should list required tools`);
    assert.ok(Array.isArray(item.expected.forbidden_tools), `${item.id} should list forbidden tools`);
  }
});

test("Phase 6 scripts wire agent, backend, and frontend quality gates", () => {
  const rootPackage = readJson(resolve(repoRoot, "package.json"));
  const backendPackage = readJson(resolve(repoRoot, "backend", "package.json"));
  const frontendPackage = readJson(resolve(repoRoot, "frontend", "package.json"));

  assert.match(rootPackage.scripts["test:phase6"], /test:agent/);
  assert.match(rootPackage.scripts["test:phase6"], /backend run test:phase6/);
  assert.match(rootPackage.scripts["test:phase6"], /frontend run test:agent-ux/);
  assert.match(rootPackage.scripts["test:agent"], /unittest discover agent\\tests/);
  assert.match(backendPackage.scripts["test:phase6"], /phase6-eval-gates\.test\.ts/);
  assert.match(frontendPackage.scripts["test:agent-ux"], /agent-ux\.test\.cjs/);
});

test("Phase 6 runtime tests and source contracts cover the remediation risks", () => {
  const agentPhase6 = readFileSync(resolve(repoRoot, "agent", "tests", "test_remediation_phase6.py"), "utf8");
  const runtimeSource = readFileSync(resolve(repoRoot, "agent", "app", "agents.py"), "utf8");
  const qualitySource = readFileSync(resolve(repoRoot, "backend", "src", "services", "agent-quality.service.ts"), "utf8");

  for (const required of [
    "test_golden_conversations_hold_intent_and_planner_contracts",
    "test_classifier_or_planner_failure_is_a_visible_degraded_gate",
    "test_disabled_llm_never_silently_enters_full_intelligence_mode",
    "test_clarify_planner_does_not_restore_fallback_write_tools",
    "test_plan_and_diet_quality_rubric_blocks_unsafe_generation"
  ]) {
    assert.match(agentPhase6, new RegExp(required));
  }

  assert.match(runtimeSource, /action == "clarify"[\s\S]*tools = \[\]/);
  assert.match(runtimeSource, /raw_tools_present/);
  for (const blocker of ["unsafe_diet_calories", "missing_recovery_guidance", "empty_training_day", "medical_red_flag"]) {
    assert.match(qualitySource, new RegExp(blocker), `quality gate should include ${blocker}`);
  }
});

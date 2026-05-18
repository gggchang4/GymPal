const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const frontendRoot = process.cwd();
const repoRoot = join(frontendRoot, "..");

const chatPage = readFileSync(join(frontendRoot, "app", "chat", "page.tsx"), "utf8");
const timeline = readFileSync(join(frontendRoot, "components", "agent-run-timeline.tsx"), "utf8");
const cards = readFileSync(join(frontendRoot, "components", "cards.tsx"), "utf8");
const api = readFileSync(join(frontendRoot, "lib", "api.ts"), "utf8");
const types = readFileSync(join(frontendRoot, "lib", "types.ts"), "utf8");
const css = readFileSync(join(frontendRoot, "app", "globals.css"), "utf8");
const evalFixture = JSON.parse(readFileSync(join(repoRoot, "docs", "evals", "remediation-golden-conversations.json"), "utf8"));

test("Phase 6 golden evals include UX-facing clarification and proposal cases", () => {
  const cases = evalFixture.cases;
  assert.ok(cases.some((item) => item.expected.should_clarify), "golden evals should include clarification cases");
  assert.ok(cases.some((item) => item.expected.requires_proposal), "golden evals should include proposal cases");
  assert.ok(cases.some((item) => item.expected.forbidden_tools.includes("create_action_proposal")), "golden evals should protect answer-only flows");
  assert.ok(cases.some((item) => item.expected.risk_level === "high"), "golden evals should include high-risk safety cases");
});

test("Chat UX keeps Phase 5 product states visible for Phase 6 regression", () => {
  assert.match(chatPage, /Promise\.all/, "thread messages, proposals, and hints should avoid sequential page-load waterfalls");
  assert.match(chatPage, /setTimelineByRunId\(\(current\)/, "timeline updates should use functional setState");
  assert.match(chatPage, /streamRun\(response\.runId/, "chat should subscribe to run timeline events");
  assert.match(chatPage, /catch\s*\{[\s\S]*Timeline stream unavailable/, "stream failures should fall back to final sync");
  assert.match(chatPage, /pendingProposals/, "pending proposal banner should remain wired");
  assert.match(chatPage, /clarification\?\.chips/, "clarification chips should remain visible");
  assert.match(chatPage, /degradedMode/, "degraded mode should remain visible");
  assert.match(chatPage, /setText\(chip\)/, "clarification chips should fill the composer without auto-send");
});

test("Tool timeline renders success, failure, and degraded states", () => {
  assert.match(timeline, /status-\$\{statusForItem\(item\)\}/);
  assert.match(timeline, /"failed"/);
  assert.match(timeline, /return "limited"/);
  assert.match(css, /status-failed/);
  assert.match(css, /status-limited/);
  assert.match(timeline, /tool_call_completed/);
  assert.match(timeline, /degraded_mode/);
  assert.match(timeline, /llm_call/);
  assert.match(types, /type RunStepType/);
  for (const stepType of ["intent_classification", "planner_decision", "tool_call_started", "tool_call_completed", "llm_call", "degraded_mode"]) {
    assert.match(types, new RegExp(`"${stepType}"`));
  }
});

test("Proposal diff and agent response metadata contracts are still rendered", () => {
  assert.match(cards, /function ProposalDiffDetails/);
  assert.match(cards, /before/);
  assert.match(cards, /after/);
  assert.match(cards, /memory_candidate_card/);
  for (const field of ["clarification", "usedMemories", "pendingProposalCount", "degradedMode", "intentConfidence"]) {
    assert.match(types, new RegExp(field));
  }
  for (const rawField of ["pending_proposal_count", "used_memories", "intent_confidence", "degraded_mode"]) {
    assert.match(api, new RegExp(rawField));
  }
});

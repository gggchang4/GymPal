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
const evalFixture = JSON.parse(readFileSync(join(repoRoot, "evals", "agent-golden-conversations.json"), "utf8"));

test("golden evals include UX-facing clarification and proposal cases", () => {
  const cases = evalFixture.cases;
  assert.ok(cases.some((item) => item.expected.should_clarify), "golden evals should include clarification cases");
  assert.ok(cases.some((item) => item.expected.requires_proposal), "golden evals should include proposal cases");
  assert.ok(cases.some((item) => item.expected.forbidden_tools.includes("create_action_proposal")), "golden evals should protect answer-only flows");
  assert.ok(cases.some((item) => item.expected.risk_level === "high"), "golden evals should include high-risk cases");
});

test("Chat UX keeps product-grade agent states visible", () => {
  assert.match(chatPage, /Promise\.all/, "thread messages, proposals, and hints should avoid page-load waterfalls");
  assert.match(chatPage, /GymPal 正在思考/, "pending assistant message should show a simple thinking state");
  assert.doesNotMatch(chatPage, /AgentRunTimeline/, "internal run timelines should stay out of the default user chat");
  assert.doesNotMatch(chatPage, /streamRun\(response\.runId/, "default chat should not stream internal trace steps to users");
  assert.doesNotMatch(chatPage, /message\.reasoningSummary/, "reasoning summaries should not render in user-facing bubbles");
  assert.match(chatPage, /pendingProposals/, "pending proposal banner should remain wired");
  assert.match(chatPage, /clarification\?\.chips/, "clarification chips should remain visible");
  assert.match(chatPage, /degradedMode/, "degraded mode should remain visible");
  assert.match(chatPage, /setText\(chip\)/, "chips should fill composer without auto-send");
  assert.match(cards, /hiddenUserCardTypes/, "internal cards should be filtered before rendering");
  assert.match(cards, /"reasoning_summary_card", "tool_activity_card"/, "reasoning and tool cards should be hidden by default");
  assert.match(cards, /shouldShowUserCard/, "card visibility should support product-facing filtering");
  assert.match(cards, /"executed", "succeeded"/, "successful execution result cards should be hidden from chat");
  assert.match(chatPage, /像训练搭子一样/, "welcome copy should position GymPal as a training buddy");
  assert.doesNotMatch(chatPage, /意图 \{lastAgentMeta\.intent\}/, "debug intent chips should not be shown in the default chat chrome");
  assert.doesNotMatch(chatPage, /工具 \{lastAgentMeta\.toolCount\}/, "debug tool-count chips should not be shown in the default chat chrome");
});

test("Tool timeline component remains available for non-chat diagnostics", () => {
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

test("Proposal diff and response metadata contracts are still rendered", () => {
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

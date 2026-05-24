const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const repoRoot = join(process.cwd(), "..");
const frontendTypes = readFileSync(join(process.cwd(), "lib", "types.ts"), "utf8");
const frontendCards = readFileSync(join(process.cwd(), "components", "cards.tsx"), "utf8");
const agentModels = readFileSync(join(repoRoot, "agent", "app", "models.py"), "utf8");

const requiredCardTypes = [
  "action_proposal_card",
  "action_result_card",
  "tool_activity_card",
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
  "coach_workspace_card"
];

test("frontend and agent share the agent card contract", () => {
  for (const cardType of requiredCardTypes) {
    assert.match(frontendTypes, new RegExp(`"${cardType}"`), `frontend type union should include ${cardType}`);
    assert.match(agentModels, new RegExp(`"${cardType}"`), `agent CardType should include ${cardType}`);
    assert.match(frontendCards, new RegExp(`${cardType}:`), `frontend card renderer should style ${cardType}`);
  }
});

test("response metadata and run step types are shared by frontend and agent", () => {
  for (const field of ["degradedMode", "degradedReason", "intent", "intentConfidence"]) {
    assert.match(frontendTypes, new RegExp(field), `PostMessageResponse should expose ${field}`);
  }

  for (const rawField of ["degraded_mode", "degraded_reason", "intent_confidence"]) {
    assert.match(readFileSync(join(process.cwd(), "lib", "api.ts"), "utf8"), new RegExp(rawField));
  }

  for (const stepType of ["llm_call", "intent_classification", "planner_decision", "degraded_mode"]) {
    assert.match(frontendTypes, new RegExp(`"${stepType}"`));
    assert.match(agentModels, new RegExp(`"${stepType}"`));
  }
});

test("product cards have dedicated render paths", () => {
  for (const renderer of ["WorkItemDetails", "QualityCheckDetails", "RevisionDetails", "CoachWorkspaceDetails"]) {
    assert.match(frontendCards, new RegExp(`function ${renderer}`), `${renderer} should be implemented explicitly`);
  }

  assert.match(frontendCards, /terminalWorkItemStatuses/, "work item cards should model terminal states");
});

test("chat experience exposes user-facing clarification, pending, and proposal diff contracts", () => {
  const chatPage = readFileSync(join(process.cwd(), "app", "chat", "page.tsx"), "utf8");
  const api = readFileSync(join(process.cwd(), "lib", "api.ts"), "utf8");
  const timeline = readFileSync(join(process.cwd(), "components", "agent-run-timeline.tsx"), "utf8");

  for (const field of ["clarification", "usedMemories", "pendingProposalCount"]) {
    assert.match(frontendTypes, new RegExp(field), `PostMessageResponse should expose ${field}`);
  }

  for (const typeName of ["AgentRunTimelineItem", "ClarificationState", "UsedMemory", "ProposalDiff", "AgentActionProposal"]) {
    assert.match(frontendTypes, new RegExp(`interface ${typeName}`), `${typeName} should be defined`);
  }

  assert.match(api, /getThreadProposals/);
  assert.doesNotMatch(chatPage, /streamRun/);
  assert.doesNotMatch(chatPage, /timelineByRunId/);
  assert.doesNotMatch(chatPage, /message\.reasoningSummary/);
  assert.match(chatPage, /pendingProposals/);
  assert.match(frontendCards, /ProposalDiffDetails/);
  assert.match(frontendCards, /hiddenUserCardTypes/);
  assert.match(timeline, /AgentRunTimeline/);
});

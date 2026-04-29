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
  "weekly_review_card",
  "daily_guidance_card",
  "coaching_package_card",
  "evidence_card",
  "memory_candidate_card",
  "outcome_summary_card",
  "strategy_decision_card"
];

test("frontend and agent share the Phase 1/2/3 card contract", () => {
  for (const cardType of requiredCardTypes) {
    assert.match(frontendTypes, new RegExp(`"${cardType}"`), `frontend type union should include ${cardType}`);
    assert.match(agentModels, new RegExp(`"${cardType}"`), `agent CardType should include ${cardType}`);
    assert.match(frontendCards, new RegExp(`${cardType}:`), `frontend card renderer should style ${cardType}`);
  }
});

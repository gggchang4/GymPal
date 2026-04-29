const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]+)\\}`, "m"));
  return match?.groups?.body ?? "";
}

function ruleForSelectorPattern(selectorPattern) {
  const match = css.match(new RegExp(`${selectorPattern}\\s*\\{(?<body>[^}]+)\\}`, "m"));
  return match?.groups?.body ?? "";
}

function assertLongTextSafe(label, rule) {
  assert.match(rule, /overflow-wrap:\s*anywhere;/, `${label} should wrap long unbroken text.`);
  assert.match(rule, /word-break:\s*break-word;/, `${label} should avoid horizontal overflow.`);
}

test("chat cards and message bubbles keep long generated text inside their containers", () => {
  assertLongTextSafe(".message-bubble", ruleFor(".message-bubble"));
  assertLongTextSafe(".info-card", ruleFor(".info-card"));
  assertLongTextSafe(
    ".info-list li",
    ruleForSelectorPattern("\\.info-list li,\\s*\\.exercise-notes li")
  );
  assertLongTextSafe(".evidence-list li", ruleFor(".evidence-list li"));
  assertLongTextSafe(".evidence-tag", ruleFor(".evidence-tag"));
  assertLongTextSafe(".phase4-card-status-grid strong", ruleFor(".phase4-card-status-grid strong"));
  assertLongTextSafe(".revision-compare-grid p", ruleFor(".revision-compare-grid p"));
});

test("Phase 4 card layouts use stable responsive grids", () => {
  assert.match(
    ruleFor(".phase4-card-status-grid"),
    /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(118px,\s*1fr\)\);/,
    "Phase 4 status grid should not resize around dynamic text."
  );
  assert.match(
    ruleFor(".revision-compare-grid"),
    /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(160px,\s*1fr\)\);/,
    "Revision compare grid should keep old and new summaries stable."
  );
});

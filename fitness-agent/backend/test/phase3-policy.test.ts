import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException } from "@nestjs/common";
import { AgentPolicyService } from "../src/services/agent-policy.service";

test("phase3 policy allows known actions and derives package labels", () => {
  const policy = new AgentPolicyService();

  assert.ok(policy.getSupportedActionTypes().includes("create_recommendation_feedback"));
  assert.deepEqual(
    policy.getPolicyLabelsForActions(["generate_next_week_plan", "generate_diet_snapshot"], ["custom_label"]),
    ["custom_label", "plan_rewrite", "nutrition_rewrite", "multi_domain_package"]
  );
});

test("phase3 policy blocks unsupported actions", () => {
  const policy = new AgentPolicyService();

  assert.throws(
    () => policy.assertActionAllowed("freeform_database_write", {}),
    (error) => error instanceof ConflictException && error.message.includes("Unsupported action type")
  );
});

test("phase3 policy blocks non-package actions inside coaching packages", () => {
  const policy = new AgentPolicyService();

  assert.throws(
    () => policy.assertActionAllowed("generate_plan", { goal: "fat_loss" }, { packageContext: true }),
    (error) => error instanceof ConflictException && error.message.includes("transactional coaching package")
  );

  assert.throws(
    () => policy.assertActionAllowed("adjust_plan", { note: "adjust active plan" }, { packageContext: true }),
    (error) => error instanceof ConflictException && error.message.includes("transactional coaching package")
  );
});

test("phase3 policy blocks medical red-flag writes", () => {
  const policy = new AgentPolicyService();

  assert.throws(
    () =>
      policy.assertActionAllowed("create_advice_snapshot", {
        summary: "User reported chest pain during training. Create a training recommendation."
      }),
    (error) => error instanceof ConflictException && error.message.includes("Medical red-flag")
  );
});

import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { AgentPolicyService } from "../src/services/agent-policy.service";

test("agent ToolGateway execute_agent_command covers every backend policy action", () => {
  const policy = new AgentPolicyService();
  const gatewaySource = readFileSync(resolve(__dirname, "..", "..", "agent", "app", "tool_gateway.py"), "utf8");
  const missing = policy
    .getSupportedActionTypes()
    .filter((actionType) => !new RegExp(`"${actionType}"\\s*:`).test(gatewaySource));

  assert.deepEqual(missing, []);
});

test("P0-P2 tool invocation logging endpoint persists planner metadata", () => {
  const controllerSource = readFileSync(resolve(__dirname, "..", "src", "controllers", "agent-state.controller.ts"), "utf8");
  const serviceSource = readFileSync(resolve(__dirname, "..", "src", "services", "agent-state.service.ts"), "utf8");
  const dtoSource = readFileSync(resolve(__dirname, "..", "src", "dtos", "agent.dto.ts"), "utf8");

  assert.match(controllerSource, /@Post\("tool-invocations"\)/);
  assert.match(controllerSource, /@CurrentUser\(\) user: AuthTokenClaims/);
  assert.match(serviceSource, /toolInvocationLog\.create/);
  assert.match(serviceSource, /getThreadForActor\(threadId, userId\)/);
  assert.match(dtoSource, /class CreateToolInvocationLogDto/);
  assert.match(dtoSource, /requestData/);
  assert.match(dtoSource, /responseData/);
});

test("P2 planner tool whitelist only references implemented or virtual tools", () => {
  const gatewaySource = readFileSync(resolve(__dirname, "..", "..", "agent", "app", "tool_gateway.py"), "utf8");
  const runtimeSource = readFileSync(resolve(__dirname, "..", "..", "agent", "app", "agents.py"), "utf8");
  const allowedTools = [
    "get_coach_summary",
    "load_current_plan",
    "get_memory_summary",
    "get_workspace_summary",
    "get_exercise_catalog",
    "get_recovery_guidance",
    "geocode_location",
    "reverse_geocode",
    "search_nearby_places",
    "create_action_proposal"
  ];

  for (const tool of allowedTools) {
    assert.match(runtimeSource, new RegExp(`"${tool}"`));
    if (tool !== "create_action_proposal") {
      assert.match(gatewaySource, new RegExp(`async def ${tool}\\(`));
    }
  }
});

test("P3-P5 memory schema and context APIs expose personalization hooks", () => {
  const schema = readFileSync(resolve(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const contextController = readFileSync(resolve(__dirname, "..", "src", "controllers", "agent-context.controller.ts"), "utf8");
  const stateController = readFileSync(resolve(__dirname, "..", "src", "controllers", "agent-state.controller.ts"), "utf8");
  const appStore = readFileSync(resolve(__dirname, "..", "src", "store", "app-store.service.ts"), "utf8");

  for (const field of ["category", "relevanceTags", "sourceMessageId", "expiresAt", "conflictGroupId", "conflictStatus", "lastUsedAt", "useCount"]) {
    assert.match(schema, new RegExp(field), `UserCoachingMemory should include ${field}`);
  }

  assert.match(schema, /@@index\(\[userId, category, status\]\)/);
  assert.match(schema, /@@index\(\[userId, conflictStatus\]\)/);
  assert.match(contextController, /@Query\("categories"\)/);
  assert.match(contextController, /@Query\("tags"\)/);
  assert.match(contextController, /@Query\("includeExpired"\)/);
  assert.match(stateController, /@Post\("memories\/:memoryId\/mark-used"\)/);
  assert.match(appStore, /markCoachingMemoryUsed/);
});

test("P3 generated plan and adjust plan payloads have deterministic executor paths", () => {
  const executor = readFileSync(resolve(__dirname, "..", "src", "services", "agent-action-executor.service.ts"), "utf8");
  const appStore = readFileSync(resolve(__dirname, "..", "src", "store", "app-store.service.ts"), "utf8");
  const quality = readFileSync(resolve(__dirname, "..", "src", "services", "agent-quality.service.ts"), "utf8");

  assert.match(executor, /Array\.isArray\(payload\.days\)/);
  assert.match(appStore, /GeneratedWorkoutPlanPayload/);
  assert.match(appStore, /payload\?\.changes/);
  assert.match(quality, /unsafe_diet_calories/);
  assert.match(quality, /missing_recovery_guidance/);
  assert.match(quality, /empty_training_day/);
});

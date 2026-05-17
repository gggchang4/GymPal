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

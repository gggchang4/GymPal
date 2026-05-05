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

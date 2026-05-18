const agentThreadStorageKey = "fitness-agent-chat-thread";
const agentIntentHintStorageKey = "fitness-agent-chat-intent-hint";

function canUseDom() {
  return typeof window !== "undefined";
}

export function readAgentThreadId() {
  if (!canUseDom()) {
    return "";
  }

  return window.localStorage.getItem(agentThreadStorageKey) ?? "";
}

export function writeAgentThreadId(threadId: string) {
  if (!canUseDom()) {
    return;
  }

  window.localStorage.setItem(agentThreadStorageKey, threadId);
}

export function clearAgentThreadId() {
  if (!canUseDom()) {
    return;
  }

  window.localStorage.removeItem(agentThreadStorageKey);
  window.localStorage.removeItem(agentIntentHintStorageKey);
}

export function readAgentIntentHint() {
  if (!canUseDom()) {
    return "";
  }

  return window.localStorage.getItem(agentIntentHintStorageKey) ?? "";
}

export function writeAgentIntentHint(hint: string) {
  if (!canUseDom() || !hint.trim()) {
    return;
  }

  window.localStorage.setItem(agentIntentHintStorageKey, hint.trim());
}

export function clearAgentIntentHint() {
  if (!canUseDom()) {
    return;
  }

  window.localStorage.removeItem(agentIntentHintStorageKey);
}

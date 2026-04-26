const agentThreadStorageKey = "fitness-agent-chat-thread";

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
}

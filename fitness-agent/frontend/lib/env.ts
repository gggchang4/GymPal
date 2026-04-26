function normalizeBaseUrl(value: string | undefined, fallback: string) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return fallback;
  }

  return normalizedValue.replace(/\/+$/, "");
}

export const frontendEnv = {
  backendBaseUrl: normalizeBaseUrl(
    process.env.NEXT_PUBLIC_BACKEND_URL,
    "http://127.0.0.1:3001"
  ),
  agentBaseUrl: normalizeBaseUrl(process.env.NEXT_PUBLIC_AGENT_URL, "http://127.0.0.1:8000")
} as const;

"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentCardList } from "@/components/cards";
import { AgentRunTimeline } from "@/components/agent-run-timeline";
import {
  approveProposal,
  approveProposalGroup,
  createThread,
  getThreadMessages,
  getThreadProposals,
  postMessage,
  rejectProposal,
  rejectProposalGroup,
  streamRun,
  submitRecommendationFeedback
} from "@/lib/api";
import { clearAgentIntentHint, readAgentIntentHint, readAgentThreadId, writeAgentThreadId } from "@/lib/agent-thread";
import { readAuthAccessToken, subscribeAuthChange } from "@/lib/auth";
import { appRoutes } from "@/lib/routes";
import type { AgentActionProposal, AgentMessage, AgentRunTimelineItem, PostMessageResponse, RecommendationFeedbackType } from "@/lib/types";

const initialMessages: AgentMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "你可以直接询问训练、恢复和饮食建议，也可以让我先整理一条待确认的执行提案。这里的回复会实时依赖后端和 Agent 服务。"
  }
];

function buildErrorMessage(error: unknown, action: "message" | "proposal" | "package") {
  const detail = error instanceof Error ? error.message : "未知错误";

  if (detail.includes("Missing bearer token") || detail.includes("Authentication required")) {
    return "当前登录状态已失效，请重新登录后再试。";
  }

  if (detail.includes("already been executed")) {
    return action === "package"
      ? "这份教练包已经执行过了，刷新页面后查看最新状态。"
      : "这条提案已经执行过了，刷新页面后查看最新状态。";
  }

  if (detail.includes("expired") || detail.includes("changed") || detail.includes("no longer exists")) {
    return "这条提案已经过期，请重新生成。";
  }

  if (action === "proposal") {
    return `提案处理失败：${detail}`;
  }

  if (action === "package") {
    return `教练包处理失败：${detail}`;
  }

  return `请求失败：${detail}`;
}

function buildAgentMeta(response: PostMessageResponse) {
  const nextActions = response.nextActions.slice(0, 3);
  return {
    degradedMode: response.degradedMode,
    degradedReason: response.degradedReason,
    intent: response.intent,
    intentConfidence: response.intentConfidence,
    clarification: response.clarification,
    usedMemories: response.usedMemories,
    pendingProposalCount: response.pendingProposalCount,
    nextActions,
    hasDetail: response.degradedMode || nextActions.length > 0 || Boolean(response.clarification) || response.usedMemories.length > 0,
    toolCount: response.toolEvents.filter((event) => event.event === "tool_call_completed").length
  };
}

function mapTimelineItem(runId: string, item: { data: { id: string; step_type: AgentRunTimelineItem["stepType"]; title: string; payload: Record<string, unknown>; created_at?: string } }): AgentRunTimelineItem {
  return {
    runId,
    id: item.data.id,
    stepType: item.data.step_type,
    title: item.data.title,
    payload: item.data.payload,
    createdAt: item.data.created_at
  };
}

export default function ChatPage() {
  const router = useRouter();
  const [threadId, setThreadId] = useState("");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>(initialMessages);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在连接助手");
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [hasAuthToken, setHasAuthToken] = useState<boolean | null>(null);
  const [lastAgentMeta, setLastAgentMeta] = useState<ReturnType<typeof buildAgentMeta> | null>(null);
  const [timelineByRunId, setTimelineByRunId] = useState<Record<string, AgentRunTimelineItem[]>>({});
  const [activeRunId, setActiveRunId] = useState("");
  const [pendingProposals, setPendingProposals] = useState<AgentActionProposal[]>([]);
  const [intentHint, setIntentHint] = useState("");

  const mountedRef = useRef(true);
  const threadPromiseRef = useRef<Promise<string> | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const syncAuthState = () => {
      const authenticated = Boolean(readAuthAccessToken());
      setHasAuthToken(authenticated);

      if (!authenticated) {
        setStatus("登录状态已失效，正在跳转到登录页");
        router.replace(appRoutes.login);
      }
    };

    syncAuthState();
    return subscribeAuthChange(syncAuthState);
  }, [router]);

  const hydrateThread = useCallback(async (existingThreadId: string) => {
    const [history, proposals] = await Promise.all([
      getThreadMessages(existingThreadId),
      getThreadProposals(existingThreadId)
    ]);
    if (!mountedRef.current) {
      return;
    }

    setMessages(history.length > 0 ? history : initialMessages);
    setPendingProposals(proposals.filter((proposal) => proposal.status === "pending" || proposal.status === "approved"));
    setStatus("助手已连接");
  }, []);

  const ensureThread = useCallback(async (): Promise<string> => {
    if (threadId) {
      return threadId;
    }

    if (!threadPromiseRef.current) {
      threadPromiseRef.current = (async () => {
        const cachedThreadId = readAgentThreadId();
        if (cachedThreadId) {
          await hydrateThread(cachedThreadId);
          if (mountedRef.current) {
            setThreadId(cachedThreadId);
          }
          return cachedThreadId;
        }

        const result = await createThread();
        if (mountedRef.current) {
          setThreadId(result.threadId);
          setStatus("助手已连接");
          writeAgentThreadId(result.threadId);
        }
        return result.threadId;
      })()
        .catch((error) => {
          if (mountedRef.current) {
            const message = error instanceof Error ? error.message : "无法创建对话线程";
            setStatus(message);
          }
          throw error;
        })
        .finally(() => {
          threadPromiseRef.current = null;
        });
    }

    return threadPromiseRef.current;
  }, [hydrateThread, threadId]);

  useEffect(() => {
    if (hasAuthToken !== true) {
      return;
    }

    const hint = readAgentIntentHint();
    if (hint) {
      setIntentHint(hint);
      clearAgentIntentHint();
    }
    void ensureThread();
  }, [ensureThread, hasAuthToken]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollAnchorRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, busy, pendingProposalId]);

  async function refreshMessages(activeThreadId: string) {
    const [history, proposals] = await Promise.all([
      getThreadMessages(activeThreadId),
      getThreadProposals(activeThreadId)
    ]);
    if (!mountedRef.current) {
      return;
    }

    setMessages(history.length > 0 ? history : initialMessages);
    setPendingProposals(proposals.filter((proposal) => proposal.status === "pending" || proposal.status === "approved"));
  }

  async function onSubmit() {
    if (hasAuthToken !== true || !text.trim() || busy) {
      return;
    }

    const content = text.trim();
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content
    };
    const placeholderMessage: AgentMessage = {
      id: `assistant-${crypto.randomUUID()}`,
      role: "assistant",
      content: "GymPal is working...",
      reasoningSummary: "Waiting for the agent run timeline."
    };

    setMessages((current) => [...current, userMessage, placeholderMessage]);
    setText("");
    setBusy(true);
    setStatus("正在发送消息");

    try {
      const activeThreadId = await ensureThread();
      const response = await postMessage(activeThreadId, content);
      setLastAgentMeta(buildAgentMeta(response));
      setActiveRunId(response.runId);
      setTimelineByRunId((current) => ({ ...current, [response.runId]: [] }));
      try {
        await streamRun(response.runId, (event) => {
          setTimelineByRunId((current) => ({
            ...current,
            [response.runId]: [...(current[response.runId] ?? []), mapTimelineItem(response.runId, event)]
          }));
        });
      } catch {
        setStatus("Timeline stream unavailable; syncing final messages.");
      }
      await refreshMessages(activeThreadId);
      setStatus(response.degradedMode ? "Agent 当前使用受限模式" : "已同步最新消息");
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: buildErrorMessage(error, "message"),
          reasoningSummary: "这次失败反映的是当前后端或 Agent 服务的真实状态。"
        }
      ]);
      setLastAgentMeta(null);
      setStatus("消息发送失败");
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  async function handleProposalDecision(proposalId: string, decision: "approve" | "reject") {
    if (hasAuthToken !== true || pendingProposalId || !threadId) {
      return;
    }

    setPendingProposalId(proposalId);
    setStatus(decision === "approve" ? "正在执行提案" : "正在拒绝提案");

    try {
      if (decision === "approve") {
        await approveProposal(proposalId);
      } else {
        await rejectProposal(proposalId);
      }

      await refreshMessages(threadId);
      setStatus("提案状态已更新");
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: buildErrorMessage(error, "proposal"),
          reasoningSummary: "提案确认链路失败后，不会把这次操作视为成功执行。"
        }
      ]);
      setStatus("提案处理失败");
    } finally {
      if (mountedRef.current) {
        setPendingProposalId(null);
      }
    }
  }

  async function handleProposalGroupDecision(proposalGroupId: string, decision: "approve" | "reject") {
    if (hasAuthToken !== true || pendingProposalId || !threadId) {
      return;
    }

    setPendingProposalId(proposalGroupId);
    setStatus(decision === "approve" ? "正在执行教练包" : "正在拒绝教练包");

    try {
      if (decision === "approve") {
        await approveProposalGroup(proposalGroupId);
      } else {
        await rejectProposalGroup(proposalGroupId);
      }

      await refreshMessages(threadId);
      setStatus("教练包状态已更新");
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: buildErrorMessage(error, "package"),
          reasoningSummary: "这次失败发生在教练包确认链路，数据库不会把它视为一次成功应用。"
        }
      ]);
      setStatus("教练包处理失败");
    } finally {
      if (mountedRef.current) {
        setPendingProposalId(null);
      }
    }
  }

  async function handleRecommendationFeedback(payload: {
    reviewSnapshotId?: string | null;
    proposalGroupId?: string | null;
    feedbackType: RecommendationFeedbackType;
  }) {
    if (hasAuthToken !== true || pendingProposalId) {
      return;
    }

    setPendingProposalId(payload.proposalGroupId || payload.reviewSnapshotId || "recommendation-feedback");
    setStatus("正在保存反馈");

    try {
      await submitRecommendationFeedback(payload);
      setStatus("反馈已保存");
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: buildErrorMessage(error, "message"),
          reasoningSummary: "反馈写入失败时，不会影响已有教练包、计划或日志状态。"
        }
      ]);
      setStatus("反馈保存失败");
    } finally {
      if (mountedRef.current) {
        setPendingProposalId(null);
      }
    }
  }

  return (
    <div className="page chat-page">
      <section className="chat-surface">
        <div className="chat-meta-row">
          <span className="section-label">Agent</span>
          <div className="chip-row">
            <span className={`status-pill ${busy || pendingProposalId ? "live" : "idle"}`}>{status}</span>
            <span className="mini-chip">{threadId ? "已连接线程" : "尚未建立线程"}</span>
            {lastAgentMeta?.intent ? <span className="mini-chip">意图 {lastAgentMeta.intent}</span> : null}
            {lastAgentMeta?.toolCount ? <span className="mini-chip">工具 {lastAgentMeta.toolCount}</span> : null}
          </div>
        </div>
        {lastAgentMeta?.hasDetail ? (
          <div className="chat-meta-row">
            <span className="section-label">{lastAgentMeta.degradedMode ? "受限模式" : "Next"}</span>
            <div className="chip-row">
              {lastAgentMeta.degradedMode ? (
                <span className="mini-chip">{lastAgentMeta.degradedReason || "LLM 暂不可用，已使用安全降级逻辑"}</span>
              ) : null}
              {lastAgentMeta.nextActions.map((action) => (
                <button key={action} type="button" className="mini-chip chip-button" onClick={() => setText(action)}>
                  {action}
                </button>
              ))}
              {lastAgentMeta.clarification?.chips.map((chip) => (
                <button key={chip} type="button" className="mini-chip chip-button" onClick={() => setText(chip)}>
                  {chip}
                </button>
              ))}
              {lastAgentMeta.usedMemories.length > 0 ? (
                <span className="mini-chip">Used memories {lastAgentMeta.usedMemories.length}</span>
              ) : null}
            </div>
          </div>
        ) : null}
        {intentHint ? (
          <div className="pending-proposal-banner">
            <span>{intentHint}</span>
            <button type="button" className="chip-button" onClick={() => setText(intentHint)}>
              Use as prompt
            </button>
            <button type="button" className="ghost-button subtle" onClick={() => setIntentHint("")}>
              Dismiss
            </button>
          </div>
        ) : null}
        {pendingProposals.length > 0 ? (
          <div className="pending-proposal-banner">
            <span>{pendingProposals.length} pending confirmation item(s)</span>
            <button
              type="button"
              className="chip-button"
              onClick={() => {
                scrollAnchorRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
                setStatus("Pending proposal cards are in this conversation.");
              }}
            >
              Jump to cards
            </button>
          </div>
        ) : null}
        {activeRunId && timelineByRunId[activeRunId]?.length ? (
          <AgentRunTimeline items={timelineByRunId[activeRunId]} />
        ) : null}

        <div className="messages chat-feed">
          {messages.map((message) => (
            <div key={message.id} className={`message-row ${message.role === "user" ? "user" : "assistant"}`}>
              {message.role === "assistant" ? (
                <>
                  <div className="message-avatar assistant">
                    <Image
                      src="/brand/gympal-logo.jpg"
                      alt="GymPal"
                      width={36}
                      height={36}
                      className="message-avatar-image"
                    />
                  </div>

                  <div className="message-bubble assistant">
                    <small>GymPal</small>
                    <div>{message.content}</div>
                    {message.reasoningSummary ? <p className="muted message-meta">{message.reasoningSummary}</p> : null}
                    {message.cards && message.cards.length > 0 ? (
                      <AgentCardList
                        cards={message.cards}
                        pendingProposalId={pendingProposalId}
                        onApproveProposal={(proposalId) => void handleProposalDecision(proposalId, "approve")}
                        onRejectProposal={(proposalId) => void handleProposalDecision(proposalId, "reject")}
                        onApproveProposalGroup={(proposalGroupId) =>
                          void handleProposalGroupDecision(proposalGroupId, "approve")
                        }
                        onRejectProposalGroup={(proposalGroupId) =>
                          void handleProposalGroupDecision(proposalGroupId, "reject")
                        }
                        onSubmitRecommendationFeedback={(payload) => void handleRecommendationFeedback(payload)}
                      />
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <div className="message-bubble user">
                    <small>你</small>
                    <div>{message.content}</div>
                  </div>

                  <div className="message-avatar user">
                    <span>U</span>
                  </div>
                </>
              )}
            </div>
          ))}
          <div ref={scrollAnchorRef} />
        </div>

        <div className="composer chat-composer">
          <textarea
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void onSubmit();
              }
            }}
            placeholder="给 GymPal 发送消息，按 Ctrl/Cmd + Enter 快速发送"
          />

          <div className="chat-composer-row compact">
            <div className="action-row">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setText("")}
                disabled={busy || Boolean(pendingProposalId) || hasAuthToken !== true}
              >
                清空
              </button>
              <button
                type="button"
                className="button"
                onClick={onSubmit}
                disabled={busy || Boolean(pendingProposalId) || hasAuthToken !== true}
              >
                {busy ? "发送中..." : "发送"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

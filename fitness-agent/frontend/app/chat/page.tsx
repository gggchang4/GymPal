"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentCardList } from "@/components/cards";
import {
  approveProposal,
  approveProposalGroup,
  createThread,
  getThreadMessages,
  getThreadProposals,
  listThreads,
  postMessage,
  rejectProposal,
  rejectProposalGroup,
  submitRecommendationFeedback
} from "@/lib/api";
import { clearAgentIntentHint, readAgentIntentHint, readAgentThreadId, writeAgentThreadId } from "@/lib/agent-thread";
import { readAuthAccessToken, subscribeAuthChange } from "@/lib/auth";
import { appRoutes } from "@/lib/routes";
import type {
  AgentActionProposal,
  AgentCard,
  AgentMessage,
  AgentThreadSummary,
  PostMessageResponse,
  RecommendationFeedbackType
} from "@/lib/types";

const initialMessages: AgentMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "我是 GymPal，可以像训练搭子一样陪你聊训练、恢复和饮食。你要我记录、调整或生成计划时，我会先确认意图和关键信息，再整理成待确认卡片。"
  }
];

const pendingAssistantContent = "GymPal 正在思考...";

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

function isOpenProposalStatus(status: string) {
  return status === "pending" || status === "approved";
}

function markCardStatus(cards: AgentCard[] | undefined, targetId: string, status: string, target: "proposal" | "proposalGroup") {
  if (!cards?.length) {
    return cards;
  }

  const idField = target === "proposal" ? "proposalId" : "proposalGroupId";
  return cards.map((card) => {
    const cardId = card.data?.[idField];
    if (cardId !== targetId) {
      return card;
    }

    return {
      ...card,
      data: {
        ...(card.data ?? {}),
        status
      }
    };
  });
}

function threadTitle(thread: AgentThreadSummary | undefined) {
  return thread?.title?.trim() || "Health Agent Chat";
}

function threadPreview(thread: AgentThreadSummary) {
  if (thread.lastMessagePreview?.trim()) {
    return thread.lastMessagePreview.trim();
  }

  if (thread.summary?.trim()) {
    return thread.summary.trim();
  }

  return "还没有消息";
}

function formatThreadTime(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export default function ChatPage() {
  const router = useRouter();
  const [threads, setThreads] = useState<AgentThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadId, setThreadId] = useState("");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>(initialMessages);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在连接助手");
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [hasAuthToken, setHasAuthToken] = useState<boolean | null>(null);
  const [lastAgentMeta, setLastAgentMeta] = useState<ReturnType<typeof buildAgentMeta> | null>(null);
  const [pendingProposals, setPendingProposals] = useState<AgentActionProposal[]>([]);
  const [intentHint, setIntentHint] = useState("");

  const mountedRef = useRef(true);
  const activeThreadRef = useRef("");
  const shouldAutoScrollRef = useRef(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const activeThread = useMemo(() => threads.find((thread) => thread.id === threadId), [threadId, threads]);

  const requestAutoScroll = useCallback(() => {
    shouldAutoScrollRef.current = true;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeThreadRef.current = threadId;
  }, [threadId]);

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

  const refreshThreadList = useCallback(async () => {
    const latestThreads = await listThreads();
    if (mountedRef.current) {
      setThreads(latestThreads);
    }
    return latestThreads;
  }, []);

  const hydrateThread = useCallback(async (existingThreadId: string) => {
    setStatus("正在加载聊天");
    const [history, proposals] = await Promise.all([
      getThreadMessages(existingThreadId),
      getThreadProposals(existingThreadId)
    ]);
    if (!mountedRef.current || activeThreadRef.current !== existingThreadId) {
      return;
    }

    setMessages(history.length > 0 ? history : initialMessages);
    setPendingProposals(proposals.filter((proposal) => isOpenProposalStatus(proposal.status)));
    setLastAgentMeta(null);
    setStatus("助手已连接");
  }, []);

  const activateThread = useCallback(
    async (nextThreadId: string) => {
      activeThreadRef.current = nextThreadId;
      setThreadId(nextThreadId);
      writeAgentThreadId(nextThreadId);
      setMessages(initialMessages);
      setPendingProposals([]);
      setLastAgentMeta(null);
      await hydrateThread(nextThreadId);
    },
    [hydrateThread]
  );

  const createAndActivateThread = useCallback(async () => {
    setStatus("正在创建新聊天");
    const result = await createThread();
    activeThreadRef.current = result.threadId;
    setThreadId(result.threadId);
    writeAgentThreadId(result.threadId);
    setMessages(initialMessages);
    setPendingProposals([]);
    setLastAgentMeta(null);
    await refreshThreadList();
    await hydrateThread(result.threadId);
    return result.threadId;
  }, [hydrateThread, refreshThreadList]);

  const loadThreadsAndSelect = useCallback(async () => {
    setThreadsLoading(true);
    setStatus("正在同步聊天列表");

    try {
      const [availableThreads] = await Promise.all([listThreads()]);
      if (!mountedRef.current) {
        return;
      }

      setThreads(availableThreads);
      const cachedThreadId = readAgentThreadId();
      const nextThreadId =
        availableThreads.find((thread) => thread.id === cachedThreadId)?.id ?? availableThreads[0]?.id;

      if (nextThreadId) {
        await activateThread(nextThreadId);
        return;
      }

      await createAndActivateThread();
    } catch (error) {
      if (mountedRef.current) {
        const message = error instanceof Error ? error.message : "无法加载聊天列表";
        setStatus(message);
      }
    } finally {
      if (mountedRef.current) {
        setThreadsLoading(false);
      }
    }
  }, [activateThread, createAndActivateThread]);

  useEffect(() => {
    if (hasAuthToken !== true) {
      return;
    }

    const hint = readAgentIntentHint();
    if (hint) {
      setIntentHint(hint);
      clearAgentIntentHint();
    }
    void loadThreadsAndSelect();
  }, [hasAuthToken, loadThreadsAndSelect]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) {
      return undefined;
    }

    shouldAutoScrollRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      scrollAnchorRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, busy, pendingProposalId]);

  async function ensureThread() {
    if (activeThreadRef.current) {
      return activeThreadRef.current;
    }

    return createAndActivateThread();
  }

  async function onSubmit() {
    if (hasAuthToken !== true || !text.trim() || busy) {
      return;
    }

    const content = text.trim();
    setBusy(true);
    setStatus("正在发送消息");

    try {
      const activeThreadId = await ensureThread();
      const userMessage: AgentMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content
      };
      const placeholderMessage: AgentMessage = {
        id: `assistant-${crypto.randomUUID()}`,
        role: "assistant",
        content: pendingAssistantContent
      };

      requestAutoScroll();
      setMessages((current) => [...current, userMessage, placeholderMessage]);
      setText("");

      const response = await postMessage(activeThreadId, content);
      if (!mountedRef.current || activeThreadRef.current !== activeThreadId) {
        return;
      }

      setLastAgentMeta(buildAgentMeta(response));
      setMessages((current) =>
        current.some((message) => message.id === placeholderMessage.id)
          ? current.map((message) =>
              message.id === placeholderMessage.id
                ? {
                    id: response.id,
                    role: response.role,
                    content: response.content,
                    cards: response.cards
                  }
                : message
            )
          : [
              ...current,
              userMessage,
              {
                id: response.id,
                role: response.role,
                content: response.content,
                cards: response.cards
              }
            ]
      );

      void Promise.all([getThreadProposals(activeThreadId), listThreads()])
        .then(([proposals, latestThreads]) => {
          if (mountedRef.current) {
            setThreads(latestThreads);
          }
          if (mountedRef.current && activeThreadRef.current === activeThreadId) {
            setPendingProposals(proposals.filter((proposal) => isOpenProposalStatus(proposal.status)));
          }
        })
        .catch(() => {
          if (mountedRef.current) {
            setStatus("回复已收到，待确认事项稍后同步");
          }
        });
      setStatus(response.degradedMode ? "GymPal 当前使用受限模式" : "已同步最新消息");
    } catch (error) {
      const errorMessage: AgentMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: buildErrorMessage(error, "message")
      };
      requestAutoScroll();
      setMessages((current) => [...current.filter((message) => message.content !== pendingAssistantContent), errorMessage]);
      setLastAgentMeta(null);
      setStatus("消息发送失败");
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  async function handleThreadSelect(nextThreadId: string) {
    if (busy || pendingProposalId || nextThreadId === threadId) {
      return;
    }

    await activateThread(nextThreadId);
  }

  async function handleNewThread() {
    if (busy || pendingProposalId) {
      return;
    }

    setText("");
    setIntentHint("");
    await createAndActivateThread();
  }

  async function handleProposalDecision(proposalId: string, decision: "approve" | "reject") {
    if (hasAuthToken !== true || pendingProposalId || !threadId) {
      return;
    }

    const activeThreadId = threadId;
    setPendingProposalId(proposalId);
    setStatus(decision === "approve" ? "正在执行提案" : "正在拒绝提案");

    try {
      const response =
        decision === "approve"
          ? await approveProposal(proposalId)
          : await rejectProposal(proposalId);
      if (decision === "approve") {
        setPendingProposals((current) => current.filter((proposal) => proposal.id !== proposalId));
      }
      requestAutoScroll();
      setMessages((current) => [
        ...current.map((message) => ({
          ...message,
          cards: markCardStatus(message.cards, proposalId, response.status, "proposal")
        })),
        {
          id: response.id,
          role: response.role,
          content: response.content,
          cards: response.cards
        }
      ]);
      void Promise.all([getThreadProposals(activeThreadId), listThreads()])
        .then(([proposals, latestThreads]) => {
          if (mountedRef.current) {
            setThreads(latestThreads);
          }
          if (mountedRef.current && activeThreadRef.current === activeThreadId) {
            setPendingProposals(proposals.filter((proposal) => isOpenProposalStatus(proposal.status)));
          }
        })
        .catch(() => undefined);
      setStatus("提案状态已更新");
    } catch (error) {
      requestAutoScroll();
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: buildErrorMessage(error, "proposal")
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

    const activeThreadId = threadId;
    setPendingProposalId(proposalGroupId);
    setStatus(decision === "approve" ? "正在执行教练包" : "正在拒绝教练包");

    try {
      const response =
        decision === "approve"
          ? await approveProposalGroup(proposalGroupId)
          : await rejectProposalGroup(proposalGroupId);
      if (decision === "approve") {
        setPendingProposals([]);
      }
      requestAutoScroll();
      setMessages((current) => [
        ...current.map((message) => ({
          ...message,
          cards: markCardStatus(message.cards, proposalGroupId, response.status, "proposalGroup")
        })),
        {
          id: response.id,
          role: response.role,
          content: response.content,
          cards: response.cards
        }
      ]);
      void Promise.all([getThreadProposals(activeThreadId), listThreads()])
        .then(([proposals, latestThreads]) => {
          if (mountedRef.current) {
            setThreads(latestThreads);
          }
          if (mountedRef.current && activeThreadRef.current === activeThreadId) {
            setPendingProposals(proposals.filter((proposal) => isOpenProposalStatus(proposal.status)));
          }
        })
        .catch(() => undefined);
      setStatus("教练包状态已更新");
    } catch (error) {
      requestAutoScroll();
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: buildErrorMessage(error, "package")
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
      requestAutoScroll();
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: buildErrorMessage(error, "message")
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
      <div className="chat-layout">
        <aside className="chat-sidebar" aria-label="聊天历史">
          <div className="chat-sidebar-head">
            <span className="section-label">Chats</span>
            <button
              type="button"
              className="button chat-new-button"
              onClick={handleNewThread}
              disabled={busy || Boolean(pendingProposalId) || hasAuthToken !== true}
            >
              新聊天
            </button>
          </div>

          <div className="chat-thread-list">
            {threadsLoading && threads.length === 0 ? <span className="mini-chip">正在加载</span> : null}
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`chat-thread-item ${thread.id === threadId ? "active" : ""}`}
                onClick={() => void handleThreadSelect(thread.id)}
                disabled={busy || Boolean(pendingProposalId)}
                aria-current={thread.id === threadId ? "true" : undefined}
              >
                <span className="chat-thread-title">{threadTitle(thread)}</span>
                <span className="chat-thread-preview">{threadPreview(thread)}</span>
                <span className="chat-thread-time">{formatThreadTime(thread.lastMessageAt ?? thread.updatedAt)}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="chat-surface">
          <div className="chat-meta-row">
            <span className="section-label">{threadTitle(activeThread)}</span>
            <div className="chip-row">
              <span className={`status-pill ${busy || pendingProposalId ? "live" : "idle"}`}>{status}</span>
              <span className="mini-chip">{threadId ? "已连接" : "准备中"}</span>
            </div>
          </div>
          {lastAgentMeta?.hasDetail ? (
            <div className="chat-meta-row">
              <span className="section-label">{lastAgentMeta.degradedMode ? "受限模式" : "下一步"}</span>
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
                  <span className="mini-chip">使用记忆 {lastAgentMeta.usedMemories.length}</span>
                ) : null}
              </div>
            </div>
          ) : null}
          {intentHint ? (
            <div className="pending-proposal-banner">
              <span>{intentHint}</span>
              <button type="button" className="chip-button" onClick={() => setText(intentHint)}>
                填入输入框
              </button>
              <button type="button" className="ghost-button subtle" onClick={() => setIntentHint("")}>
                关闭
              </button>
            </div>
          ) : null}
          {pendingProposals.length > 0 ? (
            <div className="pending-proposal-banner">
              <span>{pendingProposals.length} 个待确认事项</span>
              <button
                type="button"
                className="chip-button"
                onClick={() => {
                  scrollAnchorRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
                  setStatus("已定位到待确认卡片。");
                }}
              >
                查看卡片
              </button>
            </div>
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
    </div>
  );
}

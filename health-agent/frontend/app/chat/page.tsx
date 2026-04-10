"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AgentCardList } from "@/components/cards";
import { createThread, postMessage, streamRun } from "@/lib/api";
import type { AgentCard, AgentMessage, RunStepType, StreamEvent } from "@/lib/types";

interface TimelineEvent {
  id: string;
  type: RunStepType;
  title: string;
  summary: string;
}

const initialMessages: AgentMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "我是 GymPal。告诉我你今天的状态、目标，或者直接让我帮你安排训练。",
    reasoningSummary: "对话会优先结合恢复状态、训练目标和执行成本给出建议。"
  }
];

const quickPrompts = [
  "今天只睡了 5 小时，还适合练腿吗？",
  "帮我安排本周 4 天训练。",
  "今晚晚餐怎么搭配会更稳？"
];

function getEventSummary(event: StreamEvent): string {
  const payload = event.data.payload;

  if (event.event === "thinking_summary") {
    return typeof payload.summary === "string" ? payload.summary : "已收到思考摘要。";
  }

  if (event.event === "tool_call_started" || event.event === "tool_call_completed") {
    return typeof payload.summary === "string" ? payload.summary : "已收到工具执行事件。";
  }

  if (event.event === "card_render") {
    return typeof payload.description === "string" ? payload.description : "已生成结构化结果。";
  }

  if (event.event === "final_message") {
    return typeof payload.content === "string" ? payload.content : "已收到最终回复。";
  }

  return "已收到新的运行事件。";
}

function getEventLabel(type: RunStepType) {
  switch (type) {
    case "thinking_summary":
      return "思考";
    case "tool_call_started":
      return "调用工具";
    case "tool_call_completed":
      return "工具完成";
    case "card_render":
      return "生成卡片";
    case "final_message":
      return "最终回复";
    default:
      return "处理中";
  }
}

function getCardPayload(payload: Record<string, unknown>): AgentCard | null {
  const { type, title, description, bullets } = payload;

  if (typeof type !== "string" || typeof title !== "string" || typeof description !== "string") {
    return null;
  }

  return {
    type: type as AgentCard["type"],
    title,
    description,
    bullets: Array.isArray(bullets)
      ? bullets.filter((item): item is string => typeof item === "string")
      : []
  };
}

export default function ChatPage() {
  const [threadId, setThreadId] = useState("");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>(initialMessages);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [activeCards, setActiveCards] = useState<AgentCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在连接会话");

  const initializedRef = useRef(false);
  const mountedRef = useRef(true);
  const threadIdRef = useRef("");
  const threadPromiseRef = useRef<Promise<string> | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    initializedRef.current = true;

    if (!threadPromiseRef.current) {
      threadPromiseRef.current = requestThreadId().finally(() => {
        threadPromiseRef.current = null;
      });
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollAnchorRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, timeline, activeCards, busy]);

  async function requestThreadId() {
    try {
      const result = await createThread();
      threadIdRef.current = result.threadId;

      if (mountedRef.current) {
        setThreadId(result.threadId);
        setStatus("会话已连接");
      }

      return result.threadId;
    } catch {
      const fallbackThreadId = `thread-demo-${Date.now()}`;
      threadIdRef.current = fallbackThreadId;

      if (mountedRef.current) {
        setStatus("演示模式");
      }

      return fallbackThreadId;
    }
  }

  async function ensureThread(): Promise<string> {
    if (threadIdRef.current) {
      return threadIdRef.current;
    }

    if (!threadPromiseRef.current) {
      threadPromiseRef.current = requestThreadId().finally(() => {
        threadPromiseRef.current = null;
      });
    }

    return threadPromiseRef.current;
  }

  async function onSubmit() {
    if (!text.trim() || busy) {
      return;
    }

    const content = text.trim();
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content
    };

    setMessages((current) => [...current, userMessage]);
    setText("");
    setBusy(true);
    setTimeline([]);
    setActiveCards([]);
    setStatus("正在发送");

    try {
      const activeThreadId = await ensureThread();
      const response = await postMessage(activeThreadId, content);

      if (!mountedRef.current) {
        return;
      }

      setStatus("正在整理回复");
      const streamCards: AgentCard[] = [];
      let finalContent = response.content;
      let finalReasoning = response.reasoningSummary;
      let eventIndex = 0;

      await streamRun(response.runId, (event) => {
        if (!mountedRef.current) {
          return;
        }

        eventIndex += 1;

        setTimeline((current) => [
          ...current,
          {
            id: `${event.data.id}-${eventIndex}`,
            type: event.event,
            title: event.data.title,
            summary: getEventSummary(event)
          }
        ]);

        if (event.event === "thinking_summary") {
          if (typeof event.data.payload.summary === "string") {
            finalReasoning = event.data.payload.summary;
          }
          setStatus("正在思考");
          return;
        }

        if (event.event === "tool_call_started") {
          setStatus("正在调用工具");
          return;
        }

        if (event.event === "tool_call_completed") {
          setStatus("正在整理结果");
          return;
        }

        if (event.event === "card_render") {
          const card = getCardPayload(event.data.payload);

          if (card) {
            streamCards.push(card);
            setActiveCards([...streamCards]);
            setStatus("正在生成结果卡片");
          }

          return;
        }

        if (event.event === "final_message") {
          if (typeof event.data.payload.content === "string") {
            finalContent = event.data.payload.content;
          }
          setStatus("已完成");
        }
      });

      if (!mountedRef.current) {
        return;
      }

      const nextCards = streamCards.length > 0 ? streamCards : response.cards;

      setMessages((current) => [
        ...current,
        {
          id: response.id,
          role: "assistant",
          content: finalContent,
          reasoningSummary: finalReasoning,
          cards: nextCards
        }
      ]);
      setActiveCards(nextCards);
      setStatus("已完成");
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      const message = error instanceof Error ? error.message : "未知错误";
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `请求失败：${message}`,
          reasoningSummary: "请检查服务连接是否正常，或稍后重试。"
        }
      ]);
      setStatus("失败");
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const shownCards = activeCards.length > 0 ? activeCards : latestAssistant?.cards ?? [];

  return (
    <div className="page chat-page">
      <section className="chat-surface">
        <div className="chat-meta-row">
          <span className="section-label">对话</span>
          <div className="chip-row">
            <span className={`status-pill ${busy ? "live" : "demo"}`}>{status}</span>
            <span className="mini-chip">{threadId ? "已连接" : "演示"}</span>
          </div>
        </div>

        <div className="messages chat-feed">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`message-row ${message.role === "user" ? "user" : "assistant"}`}
            >
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
                    {message.reasoningSummary ? (
                      <p className="muted message-meta">{message.reasoningSummary}</p>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <div className="message-bubble user">
                    <small>你</small>
                    <div>{message.content}</div>
                    {message.reasoningSummary ? (
                      <p className="muted message-meta">{message.reasoningSummary}</p>
                    ) : null}
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

        {shownCards.length > 0 ? (
          <div className="chat-inline-panel">
            <span className="section-label">结果</span>
            <AgentCardList cards={shownCards} />
          </div>
        ) : null}

        {timeline.length > 0 ? (
          <div className="chat-inline-panel">
            <span className="section-label">过程</span>
            <div className="timeline-list compact">
              {timeline.map((event) => (
                <div key={event.id} className={`timeline-step ${event.type}`}>
                  <strong>{getEventLabel(event.type)}</strong>
                  <h4>{event.title}</h4>
                  <span>{event.summary}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="composer chat-composer">
          <textarea
            rows={4}
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
          <div className="chat-composer-row">
            <div className="chip-row">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="chip-button"
                  onClick={() => setText(prompt)}
                  disabled={busy}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="action-row">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setText("")}
                disabled={busy}
              >
                清空
              </button>
              <button type="button" className="button" onClick={onSubmit} disabled={busy}>
                {busy ? "发送中..." : "发送"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

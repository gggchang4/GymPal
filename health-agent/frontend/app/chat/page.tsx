"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AgentCardList } from "@/components/cards";
import { createThread, postMessage, streamRun } from "@/lib/api";
import { AgentCard, AgentMessage, RunStepType, StreamEvent } from "@/lib/types";

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
    content: "我是 GymPal。告诉我你今天的状态、目标，或者直接让我给你排训练。",
    reasoningSummary: "Chat-first mode"
  }
];

const quickPrompts = [
  "今天只睡了 5 小时，还要不要练腿？",
  "帮我排这周 4 天训练。",
  "今晚饮食怎么配更稳？"
];

function getEventSummary(event: StreamEvent): string {
  const payload = event.data.payload;

  if (event.event === "thinking_summary") {
    return typeof payload.summary === "string" ? payload.summary : "已收到推理摘要。";
  }

  if (event.event === "tool_call_started" || event.event === "tool_call_completed") {
    return typeof payload.summary === "string" ? payload.summary : "已收到工具事件。";
  }

  if (event.event === "card_render") {
    return typeof payload.description === "string" ? payload.description : "已生成结构化结果。";
  }

  if (event.event === "final_message") {
    return typeof payload.content === "string" ? payload.content : "已收到最终回复。";
  }

  return "已收到事件。";
}

function getCardPayload(payload: Record<string, unknown>): AgentCard | null {
  const type = payload.type;
  const title = payload.title;
  const description = payload.description;
  const bullets = payload.bullets;

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
  const [status, setStatus] = useState("等待输入");
  const initializedRef = useRef(false);
  const threadPromiseRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    initializedRef.current = true;

    createThread()
      .then((result) => {
        setThreadId(result.threadId);
        setStatus("线程已连接");
      })
      .catch(() => {
        setStatus("演示模式");
      });
  }, []);

  async function ensureThread(): Promise<string> {
    if (threadId) {
      return threadId;
    }

    if (!threadPromiseRef.current) {
      threadPromiseRef.current = createThread()
        .then((result) => {
          setThreadId(result.threadId);
          return result.threadId;
        })
        .finally(() => {
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
    setStatus("发送中");

    try {
      const activeThreadId = await ensureThread();
      const response = await postMessage(activeThreadId, content);

      setStatus("处理中");
      const streamCards: AgentCard[] = [];
      let finalContent = response.content;
      let finalReasoning = response.reasoningSummary;

      await streamRun(response.runId, (event) => {
        setTimeline((current) => [
          ...current,
          {
            id: event.data.id,
            type: event.event,
            title: event.data.title,
            summary: getEventSummary(event)
          }
        ]);

        if (event.event === "thinking_summary") {
          if (typeof event.data.payload.summary === "string") {
            finalReasoning = event.data.payload.summary;
          }
          setStatus("思考中");
          return;
        }

        if (event.event === "tool_call_started") {
          setStatus("调用工具");
          return;
        }

        if (event.event === "tool_call_completed") {
          setStatus("整理结果");
          return;
        }

        if (event.event === "card_render") {
          const card = getCardPayload(event.data.payload);
          if (card) {
            streamCards.push(card);
            setActiveCards([...streamCards]);
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

      setMessages((current) => [
        ...current,
        {
          id: response.id,
          role: "assistant",
          content: finalContent,
          reasoningSummary: finalReasoning,
          cards: streamCards.length > 0 ? streamCards : response.cards
        }
      ]);
      setActiveCards(streamCards.length > 0 ? streamCards : response.cards);
      setStatus("已完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown agent error.";
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `请求失败：${message}`,
          reasoningSummary: "请检查服务连接。"
        }
      ]);
      setStatus("失败");
    } finally {
      setBusy(false);
    }
  }

  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const shownCards = activeCards.length > 0 ? activeCards : latestAssistant?.cards ?? [];

  return (
    <div className="page chat-page">
      <section className="chat-surface">
        <div className="chat-meta-row">
          <span className="section-label">GymPal chat</span>
          <div className="chip-row">
            <span className={`status-pill ${busy ? "live" : "demo"}`}>{status}</span>
            <span className="mini-chip">{threadId ? "Connected" : "Demo"}</span>
          </div>
        </div>

        <div className="messages chat-feed">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`message-row ${message.role === "user" ? "user" : "assistant"}`}
            >
              <div className={`message-avatar ${message.role === "user" ? "user" : "assistant"}`}>
                {message.role === "user" ? (
                  <span>U</span>
                ) : (
                  <Image
                    src="/brand/gympal-logo.jpg"
                    alt="GymPal"
                    width={36}
                    height={36}
                    className="message-avatar-image"
                  />
                )}
              </div>

              <div className={`message-bubble ${message.role === "user" ? "user" : "assistant"}`}>
                <small>{message.role === "user" ? "You" : "GymPal"}</small>
                <div>{message.content}</div>
                {message.reasoningSummary ? (
                  <p className="muted message-meta">{message.reasoningSummary}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {shownCards.length > 0 ? (
          <div className="chat-inline-panel">
            <span className="section-label">Results</span>
            <AgentCardList cards={shownCards} />
          </div>
        ) : null}

        {timeline.length > 0 ? (
          <div className="chat-inline-panel">
            <span className="section-label">Trace</span>
            <div className="timeline-list compact">
              {timeline.map((event) => (
                <div key={event.id} className={`timeline-step ${event.type}`}>
                  <strong>{event.type}</strong>
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
            placeholder="给 GymPal 发送消息"
          />
          <div className="chat-composer-row">
            <div className="chip-row">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  className="chip-button"
                  onClick={() => setText(prompt)}
                  disabled={busy}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="action-row">
              <button className="ghost-button" onClick={() => setText("")} disabled={busy}>
                清空
              </button>
              <button className="button" onClick={onSubmit} disabled={busy}>
                {busy ? "发送中..." : "发送"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

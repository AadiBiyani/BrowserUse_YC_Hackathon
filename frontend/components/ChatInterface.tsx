"use client";

import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

interface ChatInterfaceProps {
  experimentId: Id<"experiments">;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function ChatInterface({ experimentId }: ChatInterfaceProps) {
  const messages = useQuery(api.chat.listByExperiment, { experimentId });
  const createMessage = useMutation(api.chat.create);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;

    setInput("");
    setIsSending(true);

    await createMessage({ experimentId, role: "user", content: text });

    try {
      const res = await fetch(`${API_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experiment_id: experimentId, question: text }),
      });

      if (res.ok) {
        const data = await res.json();
        await createMessage({
          experimentId,
          role: "assistant",
          content: data.answer ?? "(no answer)",
          sourcedRunIds: data.cited_trace_ids ?? [],
        });
      } else {
        await createMessage({
          experimentId,
          role: "assistant",
          content: "Sorry, the query service is unavailable right now. Please start the backend with `uvicorn api:app --reload --port 8000`.",
        });
      }
    } catch {
      await createMessage({
        experimentId,
        role: "assistant",
        content: "Could not reach the query service. Make sure the backend is running on port 8000.",
      });
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[520px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages === undefined ? (
          <LoadingDots />
        ) : messages.length === 0 ? (
          <EmptyChat />
        ) : (
          messages.map((msg) => (
            <ChatBubble key={msg._id} role={msg.role} content={msg.content} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions — only shown when conversation is empty */}
      {messages !== undefined && messages.length === 0 && (
        <div className="border-t border-slate-100 dark:border-slate-800 px-4 pt-3 pb-1 flex flex-wrap gap-2">
          {[
            "Which model performed best?",
            "Which model is cheapest?",
            "Why did any runs fail?",
            "Which model is most consistent?",
          ].map((q) => (
            <button
              key={q}
              onClick={() => setInput(q)}
              className="text-xs px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-violet-300 dark:hover:border-violet-600 hover:text-violet-600 dark:hover:text-violet-400 bg-white dark:bg-slate-800 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 flex items-end gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Ask about agent performance…"
          className="flex-1 resize-none text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-400 transition-all max-h-32"
          style={{ fieldSizing: "content" } as React.CSSProperties}
          disabled={isSending}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isSending}
          className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-violet-600 hover:bg-violet-700 active:bg-violet-800 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors shadow-sm"
          aria-label="Send"
        >
          {isSending ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

function ChatBubble({ role, content }: { role: string; content: string }) {
  const isUser = role === "user";
  const textTone = isUser ? "text-white" : "text-slate-900 dark:text-slate-100";
  const inlineCodeTone = isUser
    ? "bg-white/20"
    : "bg-slate-200 dark:bg-slate-700";
  const blockCodeTone = isUser
    ? "bg-white/15 border border-white/20"
    : "bg-slate-200 dark:bg-slate-800";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
          <span className="text-white text-[10px] font-bold">AL</span>
        </div>
      )}
      <div
        className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-violet-600 text-white rounded-tr-sm"
            : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-sm"
        }`}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ ...props }) => <p className={`${textTone} mb-2 last:mb-0`} {...props} />,
            ul: ({ ...props }) => <ul className={`list-disc pl-5 mb-2 ${textTone}`} {...props} />,
            ol: ({ ...props }) => <ol className={`list-decimal pl-5 mb-2 ${textTone}`} {...props} />,
            li: ({ ...props }) => <li className="mb-1 last:mb-0" {...props} />,
            h1: ({ ...props }) => <h1 className={`${textTone} text-base font-semibold mb-2`} {...props} />,
            h2: ({ ...props }) => <h2 className={`${textTone} text-sm font-semibold mb-2`} {...props} />,
            h3: ({ ...props }) => <h3 className={`${textTone} text-sm font-semibold mb-1`} {...props} />,
            a: ({ ...props }) => (
              <a
                className={`${textTone} underline underline-offset-2 font-medium`}
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              />
            ),
            code: ({ className, ...props }) => (
              <code
                className={`px-1 py-0.5 rounded text-[0.9em] ${inlineCodeTone} ${className ?? ""}`}
                {...props}
              />
            ),
            pre: ({ ...props }) => (
              <pre
                className={`p-2 rounded overflow-x-auto mb-2 ${blockCodeTone}`}
                {...props}
              />
            ),
            blockquote: ({ ...props }) => (
              <blockquote
                className={`border-l-2 pl-3 italic mb-2 ${
                  isUser ? "border-white/40" : "border-slate-300 dark:border-slate-600"
                } ${textTone}`}
                {...props}
              />
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-10">
      <div className="w-12 h-12 bg-violet-50 dark:bg-violet-900/20 rounded-full flex items-center justify-center mb-3">
        <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Ask about this experiment</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs">
        Ask questions like "Which model performed best?" or "What caused the most failures?"
      </p>
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="flex justify-start">
      <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

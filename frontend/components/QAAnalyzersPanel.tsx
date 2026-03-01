"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type AnalyzerType = "reward_hacking" | "failure_reasoning" | "tool_use";
type AnalyzerStatus = "queued" | "running" | "completed" | "failed";

type AnalyzerConfig = {
  type: AnalyzerType;
  title: string;
  description: string;
};

const ANALYZERS: AnalyzerConfig[] = [
  {
    type: "reward_hacking",
    title: "Reward Hacking Analyzer",
    description:
      "Detects behavior that appears to optimize reward signals without satisfying the true task intent.",
  },
  {
    type: "failure_reasoning",
    title: "Failure Mode / Reasoning Analyzer",
    description:
      "Reviews failed traces to infer likely reasoning errors and classify recurring root-cause patterns.",
  },
  {
    type: "tool_use",
    title: "Tool Use Analyzer",
    description:
      "Examines tool call patterns, loops, and ordering to identify inefficient or missing tool strategies.",
  },
];

const STATUS_STYLES: Record<AnalyzerStatus, { label: string; classes: string }> = {
  queued: {
    label: "Queued",
    classes:
      "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300",
  },
  running: {
    label: "Running",
    classes:
      "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300",
  },
  completed: {
    label: "Completed",
    classes:
      "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    classes:
      "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300",
  },
};

interface QAAnalyzersPanelProps {
  experimentId: Id<"experiments">;
}

function parseErrorMessage(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object" && "detail" in raw) {
    const detail = (raw as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return "Could not start analyzer. Please try again.";
}

function formatDate(ts?: number): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

function isAnalyzerStatus(value: string): value is AnalyzerStatus {
  return value === "queued" || value === "running" || value === "completed" || value === "failed";
}

export function QAAnalyzersPanel({ experimentId }: QAAnalyzersPanelProps) {
  const runs = useQuery(api.qaAnalyzerRuns.listByExperiment, { experimentId });
  const [startingAnalyzer, setStartingAnalyzer] = useState<AnalyzerType | null>(null);
  const [requestErrors, setRequestErrors] = useState<Partial<Record<AnalyzerType, string>>>(
    {}
  );
  const [expandedResponses, setExpandedResponses] = useState<
    Partial<Record<AnalyzerType, boolean>>
  >({});

  async function handleRunAnalyzer(analyzerType: AnalyzerType) {
    setStartingAnalyzer(analyzerType);
    setRequestErrors((prev) => ({ ...prev, [analyzerType]: "" }));

    try {
      const response = await fetch(`${API_URL}/run-analyzer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experiment_id: experimentId,
          analyzer_type: analyzerType,
        }),
      });

      if (!response.ok) {
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        setRequestErrors((prev) => ({
          ...prev,
          [analyzerType]: parseErrorMessage(body),
        }));
      }
    } catch {
      setRequestErrors((prev) => ({
        ...prev,
        [analyzerType]:
          "Could not reach the backend. Make sure the API is running on port 8000.",
      }));
    } finally {
      setStartingAnalyzer(null);
    }
  }

  if (runs === undefined) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
      {ANALYZERS.map((analyzer) => {
        const analyzerRuns = runs.filter((run) => run.analyzerType === analyzer.type);
        const latest = analyzerRuns[0] ?? null;
        const status =
          latest && isAnalyzerStatus(latest.status) ? latest.status : undefined;
        const hasLatestResult = Boolean(latest?.result && latest.result.trim().length > 0);
        const isExpanded = Boolean(expandedResponses[analyzer.type]);
        const isBusy =
          startingAnalyzer === analyzer.type || status === "queued" || status === "running";

        return (
          <section key={analyzer.type} className="p-5 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {analyzer.title}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-3xl">
                  {analyzer.description}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {status ? (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${STATUS_STYLES[status].classes}`}
                  >
                    {(status === "queued" || status === "running") && (
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    )}
                    {STATUS_STYLES[status].label}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
                    Not run
                  </span>
                )}

                <button
                  onClick={() => handleRunAnalyzer(analyzer.type)}
                  disabled={isBusy}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 active:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isBusy ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      {startingAnalyzer === analyzer.type ? "Starting..." : "Running..."}
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M6 4.5A1.5 1.5 0 0 1 8.28 3.22l6.5 4A1.5 1.5 0 0 1 14.78 9.78l-6.5 4A1.5 1.5 0 0 1 6 12.5v-8Z" />
                      </svg>
                      Run
                    </>
                  )}
                </button>
              </div>
            </div>

            {requestErrors[analyzer.type] && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {requestErrors[analyzer.type]}
              </div>
            )}

            {latest && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900 px-3.5 py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>Last started: {formatDate(latest.startedAt ?? latest.createdAt)}</span>
                    <span>Completed: {formatDate(latest.completedAt)}</span>
                    {latest.inputTraceCount !== undefined && (
                      <span>Input traces: {latest.inputTraceCount}</span>
                    )}
                  </div>
                  {hasLatestResult && (
                    <button
                      onClick={() =>
                        setExpandedResponses((prev) => ({
                          ...prev,
                          [analyzer.type]: !prev[analyzer.type],
                        }))
                      }
                      className="text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300 transition-colors"
                    >
                      {isExpanded ? "Collapse response" : "Expand response"}
                    </button>
                  )}
                </div>

                {status === "failed" && latest.error && (
                  <p className="text-xs text-red-700 dark:text-red-300">{latest.error}</p>
                )}

                {hasLatestResult ? (
                  <div
                    className={`text-xs text-slate-700 dark:text-slate-300 leading-relaxed rounded-md border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/40 p-3 ${
                      isExpanded ? "max-h-96 overflow-y-auto" : "max-h-24 overflow-hidden"
                    }`}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ ...props }) => (
                          <h1 className="text-sm font-semibold mt-2 mb-1" {...props} />
                        ),
                        h2: ({ ...props }) => (
                          <h2 className="text-sm font-semibold mt-2 mb-1" {...props} />
                        ),
                        h3: ({ ...props }) => (
                          <h3 className="text-xs font-semibold mt-2 mb-1" {...props} />
                        ),
                        p: ({ ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                        ul: ({ ...props }) => <ul className="list-disc pl-4 mb-2" {...props} />,
                        ol: ({ ...props }) => <ol className="list-decimal pl-4 mb-2" {...props} />,
                        li: ({ ...props }) => <li className="mb-0.5" {...props} />,
                        code: ({ className, ...props }) => (
                          <code
                            className={`rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 ${
                              className ?? ""
                            }`}
                            {...props}
                          />
                        ),
                        pre: ({ ...props }) => (
                          <pre
                            className="p-2 rounded bg-slate-100 dark:bg-slate-800 overflow-x-auto mb-2"
                            {...props}
                          />
                        ),
                        blockquote: ({ ...props }) => (
                          <blockquote
                            className="border-l-2 border-slate-300 dark:border-slate-700 pl-3 italic mb-2"
                            {...props}
                          />
                        ),
                      }}
                    >
                      {latest.result}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {status === "queued" || status === "running"
                      ? "Analyzer is processing traces. Results will appear automatically."
                      : "No result text available yet."}
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

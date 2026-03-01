"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";

const STATUS_STYLES: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  pending:   { dot: "bg-amber-400",              text: "text-amber-700 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",   label: "Pending"   },
  running:   { dot: "bg-blue-400 animate-pulse", text: "text-blue-700 dark:text-blue-400",     bg: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",     label: "Running"   },
  completed: { dot: "bg-emerald-400",            text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800", label: "Completed" },
  failed:    { dot: "bg-red-400",                text: "text-red-700 dark:text-red-400",       bg: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",         label: "Failed"    },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function formatDate(ts: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

export default function Home() {
  const experiments = useQuery(api.experiments.list);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-lg flex items-center justify-center shadow-sm">
              <span className="text-white text-xs font-bold">TI</span>
            </div>
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">TraceIQ</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/analytics"
              className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 text-sm font-medium px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
              </svg>
              Analytics
            </Link>
            <Link
              href="/experiments/new"
              className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Experiment
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Weights &amp; Biases for web agents
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-base max-w-xl">
            Run structured experiments across AI models, compare trace-level performance, and ask
            natural language questions about your results.
          </p>
        </div>

        {/* Sponsor row */}
        <div className="flex items-center gap-2 mb-8 flex-wrap">
          <span className="text-xs text-slate-400 dark:text-slate-500">Powered by</span>
          {["HUD", "Supermemory", "Convex", "Browser Use", "Anthropic"].map((name) => (
            <span
              key={name}
              className="text-xs px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900"
            >
              {name}
            </span>
          ))}
        </div>

        {/* Experiments list */}
        {experiments === undefined ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-[84px] bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 animate-pulse"
              />
            ))}
          </div>
        ) : experiments.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {experiments.map((exp) => (
              <Link
                key={exp._id}
                href={`/experiments/${exp._id}`}
                className="flex items-center justify-between gap-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-6 py-4 hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-sm transition-all group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                      {exp.name}
                    </span>
                    <StatusBadge status={exp.status} />
                  </div>
                  {exp.taskGoal && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-lg">
                      {exp.taskGoal}
                    </p>
                  )}
                  {exp.taskUrl && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                      {exp.taskUrl}
                    </p>
                  )}
                </div>
                <div className="flex-shrink-0 flex items-center gap-4">
                  <p className="text-xs text-slate-400 dark:text-slate-500 text-right whitespace-nowrap">
                    {formatDate(exp.createdAt)}
                  </p>
                  <svg
                    className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-violet-400 transition-colors"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-24 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
      <div className="w-16 h-16 bg-violet-50 dark:bg-violet-900/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <svg
          className="w-7 h-7 text-violet-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 1-6.23-.693L4.2 14l-1.358 5.52A48.108 48.108 0 0 0 12 20.9a48.108 48.108 0 0 0 9.16-.803L19.8 15.3Z"
          />
        </svg>
      </div>
      <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">No experiments yet</h3>
      <p className="text-sm text-slate-400 dark:text-slate-500 mb-6 max-w-sm mx-auto">
        Run your first experiment to compare AI models on a web task and get AI-powered insights.
      </p>
      <Link
        href="/experiments/new"
        className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors shadow-sm"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New Experiment
      </Link>
    </div>
  );
}

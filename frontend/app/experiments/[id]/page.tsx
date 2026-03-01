"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ComparisonTable } from "@/components/ComparisonTable";
import type { VariantMetrics } from "@/components/ComparisonTable";
import { ChatInterface } from "@/components/ChatInterface";
import { TraceViewer } from "@/components/TraceViewer";
import { LiveProgress } from "@/components/LiveProgress";

type RunSummary = {
  runId: string;
  hudTraceId?: string;
  success: boolean;
  totalSteps: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  determinismScore?: number;
};

const TOOL_CONFIG_LABELS: Record<string, string> = {
  full:            "Full toolkit",
  navigation_only: "Navigation only",
};

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  pending:   { bg: "bg-amber-50 border-amber-200",     text: "text-amber-700",    dot: "bg-amber-400",    label: "Pending"   },
  running:   { bg: "bg-blue-50 border-blue-200",       text: "text-blue-700",     dot: "bg-blue-400",     label: "Running"   },
  completed: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700",  dot: "bg-emerald-400",  label: "Completed" },
  failed:    { bg: "bg-red-50 border-red-200",         text: "text-red-700",      dot: "bg-red-400",      label: "Failed"    },
};

function ExperimentStatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function formatDate(ts: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

export default function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const experimentId = id as Id<"experiments">;

  const experiment = useQuery(api.experiments.get, { id: experimentId });
  const metrics = useQuery(api.runs.getExperimentMetrics, { experimentId });

  const [selectedRun, setSelectedRun] = useState<{ run: RunSummary; model: string; toolConfig: string } | null>(null);

  const allRuns: { run: RunSummary; model: string; toolConfig: string }[] = (metrics ?? []).flatMap((v: VariantMetrics) =>
    v.runs.map((r) => ({ run: r, model: v.model, toolConfig: v.toolConfig ?? "full" }))
  );

  const totalRuns = allRuns.length;
  const successfulRuns = allRuns.filter((r) => r.run.success).length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400 dark:text-slate-500"
              aria-label="Back to experiments"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
            </Link>
            <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-lg flex items-center justify-center shadow-sm">
                <span className="text-white text-xs font-bold">AL</span>
              </div>
              <span className="text-lg font-bold text-slate-900 dark:text-slate-100">AgentLens</span>
            </div>
          </div>
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
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {/* Experiment header */}
        {experiment === undefined ? (
          <div className="animate-pulse space-y-2">
            <div className="h-7 bg-slate-200 dark:bg-slate-800 rounded w-64" />
            <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-96" />
          </div>
        ) : experiment === null ? (
          <div className="text-center py-20 text-slate-400">Experiment not found.</div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {experiment.name}
                </h1>
                <ExperimentStatusBadge status={experiment.status} />
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm max-w-2xl">
                {experiment.taskGoal}
              </p>
              <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500 flex-wrap">
                <a
                  href={experiment.taskUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-violet-500 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  {experiment.taskUrl}
                </a>
                <span>Created {formatDate(experiment.createdAt)}</span>
              </div>
            </div>

            {/* Summary stats */}
            {metrics && metrics.length > 0 && (
              <div className="flex gap-4 flex-shrink-0">
                <StatCard label="Total Runs" value={String(totalRuns)} />
                <StatCard
                  label="Success Rate"
                  value={totalRuns > 0 ? `${Math.round((successfulRuns / totalRuns) * 100)}%` : "—"}
                  highlight={totalRuns > 0 && successfulRuns / totalRuns >= 0.5}
                />
                <StatCard label="Variants" value={String(metrics.length)} />
              </div>
            )}
          </div>
        )}

        {/* Live progress — shown when experiment is running */}
        {experiment !== undefined && experiment !== null && experiment.status === "running" && (
          <div className="rounded-xl border border-blue-100 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 p-4">
            <LiveProgress experimentId={experimentId} />
          </div>
        )}

        {/* Tabs */}
        {experiment !== undefined && experiment !== null && (
          <Tabs defaultValue="results">
            <TabsList className="mb-4">
              <TabsTrigger value="results">Results</TabsTrigger>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="traces">Traces</TabsTrigger>
            </TabsList>

            {/* ── Results tab ── */}
            <TabsContent value="results">
              {metrics === undefined ? (
                <MetricsSkeleton />
              ) : (
                <div className="space-y-4">
                  <ComparisonTable
                    metrics={metrics as VariantMetrics[]}
                    onSelectRun={(run, model, toolConfig) => setSelectedRun({ run, model, toolConfig })}
                  />
                  {metrics.length > 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 text-right">
                      Click the colored dots to inspect individual trace runs.
                    </p>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── Chat tab ── */}
            <TabsContent value="chat">
              <ChatInterface experimentId={experimentId} />
            </TabsContent>

            {/* ── Traces tab ── */}
            <TabsContent value="traces">
              {metrics === undefined ? (
                <MetricsSkeleton />
              ) : allRuns.length === 0 ? (
                <div className="py-12 text-center text-slate-400 dark:text-slate-500 text-sm">
                  No traces yet. Runs will appear here once the experiment completes.
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                        {["Model", "Tool Config", "Outcome", "Steps", "Cost", "Latency", "Determinism", "Trace ID"].map((h) => (
                          <th
                            key={h}
                            className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                      {allRuns.map(({ run, model, toolConfig }) => (
                        <tr
                          key={run.runId}
                          className="group hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                          onClick={() => setSelectedRun({ run, model, toolConfig })}
                        >
                          <td className="px-5 py-3.5 text-slate-700 dark:text-slate-300 font-medium text-xs">
                            {model}
                          </td>
                          <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 text-xs">
                            {TOOL_CONFIG_LABELS[toolConfig] ?? toolConfig}
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                                run.success
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-red-600 dark:text-red-400"
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${run.success ? "bg-emerald-400" : "bg-red-400"}`} />
                              {run.success ? "Success" : "Failure"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400">{run.totalSteps}</td>
                          <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400 font-mono text-xs">
                            ${run.totalCostUsd.toFixed(5)}
                          </td>
                          <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400">
                            {(run.totalLatencyMs / 1000).toFixed(2)}s
                          </td>
                          <td className="px-5 py-3.5 text-slate-600 dark:text-slate-400">
                            {run.determinismScore !== undefined
                              ? `${(run.determinismScore * 100).toFixed(0)}%`
                              : "—"}
                          </td>
                          <td className="px-5 py-3.5">
                            {run.hudTraceId ? (
                              <span className="font-mono text-xs text-slate-500 dark:text-slate-400 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                                {run.hudTraceId.slice(0, 12)}…
                              </span>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-700">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* Trace viewer modal */}
      {selectedRun && (
        <TraceViewer
          run={selectedRun.run}
          model={selectedRun.model}
          toolConfig={selectedRun.toolConfig}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-center min-w-[72px]">
      <p className={`text-xl font-bold ${highlight ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-slate-100"}`}>
        {value}
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 whitespace-nowrap">{label}</p>
    </div>
  );
}

function MetricsSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3 animate-pulse">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-32" />
          <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-16" />
          <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-16" />
          <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-20" />
          <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-20" />
        </div>
      ))}
    </div>
  );
}

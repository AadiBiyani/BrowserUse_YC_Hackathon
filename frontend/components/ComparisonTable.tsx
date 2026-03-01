"use client";

type RunSummary = {
  runId: string;
  hudTraceId?: string;
  success: boolean;
  totalSteps: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  determinismScore?: number;
};

export type VariantMetrics = {
  model: string;
  toolConfig: string;
  variantId: string;
  status: string;
  runCount: number;
  successCount: number;
  successRate: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  avgSteps: number;
  avgDeterminismScore: number | null;
  runs: RunSummary[];
};

interface ComparisonTableProps {
  metrics: VariantMetrics[];
  onSelectRun?: (run: RunSummary, model: string, toolConfig: string) => void;
}

const MODEL_COLORS: Record<string, string> = {
  "gpt-4o": "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800",
  "claude-sonnet-4-5": "bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800",
  "gemini-2.0-flash": "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800",
};

function ModelBadge({ model }: { model: string }) {
  const cls = MODEL_COLORS[model] ?? "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md border text-xs font-semibold ${cls}`}>
      {model}
    </span>
  );
}

const TOOL_CONFIG_LABELS: Record<string, string> = {
  full:            "Full toolkit",
  navigation_only: "Navigation only",
};

function ToolConfigBadge({ toolConfig }: { toolConfig: string }) {
  const isRestricted = toolConfig !== "full";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
        isRestricted
          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800"
          : "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
      }`}
    >
      {TOOL_CONFIG_LABELS[toolConfig] ?? toolConfig}
    </span>
  );
}

function SuccessRateCell({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const bg =
    pct >= 80
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
      : pct >= 50
      ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
      : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-sm font-semibold ${bg}`}>
      {pct}%
    </span>
  );
}

function DeterminismCell({ score, runCount }: { score: number | null; runCount: number }) {
  if (score === null) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500 cursor-help"
        title={runCount < 2 ? "Need ≥2 runs to compute determinism" : "Not yet computed"}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
        </svg>
        {runCount < 2 ? "—" : "pending"}
      </span>
    );
  }
  const pct = Math.round(score * 100);
  const [bg, bar] =
    pct >= 75
      ? ["bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800", "bg-emerald-400 dark:bg-emerald-500"]
      : pct >= 50
      ? ["bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800", "bg-amber-400 dark:bg-amber-500"]
      : ["bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800", "bg-red-400 dark:bg-red-500"];

  return (
    <span
      className={`inline-flex flex-col gap-0.5 px-2.5 py-1 rounded-md border text-xs font-semibold min-w-[52px] ${bg}`}
      title={`Behavioural determinism: ${pct}% — how consistently this model takes the same actions across runs (SequenceMatcher ratio over tool-call sequences)`}
    >
      <span>{pct}%</span>
      <span className="w-full h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
        <span className={`block h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5 text-blue-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-label="Running"
    >
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
  );
}

function VariantStatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
        <Spinner />
        Running
      </span>
    );
  }
  const styles: Record<string, string> = {
    pending: "text-amber-600 dark:text-amber-400",
    success: "text-emerald-600 dark:text-emerald-400",
    failure: "text-red-600 dark:text-red-400",
  };
  return (
    <span className={`text-xs font-medium ${styles[status] ?? "text-slate-500"}`}>
      {status}
    </span>
  );
}

export function ComparisonTable({ metrics, onSelectRun }: ComparisonTableProps) {
  if (metrics.length === 0) {
    return (
      <div className="py-12 text-center text-slate-400 dark:text-slate-500 text-sm">
        No results yet. Runs will appear here as they complete.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            {["Model", "Tool Config", "Status", "Runs", "Success Rate", "Avg Steps", "Avg Cost", "Avg Latency", "Determinism"].map((h) => (
              <th
                key={h}
                className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap"
              >
                {h}
              </th>
            ))}
            {onSelectRun && <th className="px-5 py-3.5" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
          {metrics.map((v) => {
            const isRunning = v.status === "running";
            const hasData = v.runCount > 0;
            return (
              <tr
                key={v.variantId}
                className={`group transition-colors ${
                  isRunning
                    ? "bg-blue-50/40 dark:bg-blue-950/20"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                }`}
              >
                <td className="px-5 py-4">
                  <ModelBadge model={v.model} />
                </td>
                <td className="px-5 py-4">
                  <ToolConfigBadge toolConfig={v.toolConfig} />
                </td>
                <td className="px-5 py-4">
                  <VariantStatusBadge status={v.status} />
                </td>
                <td className="px-5 py-4 text-slate-700 dark:text-slate-300 font-medium">
                  {isRunning && !hasData ? (
                    <span className="inline-block h-3 w-4 rounded bg-blue-100 dark:bg-blue-900/40 animate-pulse" />
                  ) : (
                    v.runCount
                  )}
                </td>
                <td className="px-5 py-4">
                  {isRunning && !hasData ? (
                    <span className="inline-block h-5 w-10 rounded bg-blue-100 dark:bg-blue-900/40 animate-pulse" />
                  ) : hasData ? (
                    <SuccessRateCell rate={v.successRate} />
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-5 py-4 text-slate-600 dark:text-slate-400">
                  {isRunning && !hasData ? (
                    <span className="inline-block h-3 w-8 rounded bg-blue-100 dark:bg-blue-900/40 animate-pulse" />
                  ) : hasData ? (
                    v.avgSteps.toFixed(1)
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-4 text-slate-600 dark:text-slate-400 font-mono text-xs">
                  {isRunning && !hasData ? (
                    <span className="inline-block h-3 w-14 rounded bg-blue-100 dark:bg-blue-900/40 animate-pulse" />
                  ) : hasData ? (
                    `$${v.avgCostUsd.toFixed(4)}`
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-4 text-slate-600 dark:text-slate-400">
                  {isRunning && !hasData ? (
                    <span className="inline-block h-3 w-10 rounded bg-blue-100 dark:bg-blue-900/40 animate-pulse" />
                  ) : hasData ? (
                    `${(v.avgLatencyMs / 1000).toFixed(1)}s`
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-4">
                  {isRunning && !hasData ? (
                    <span className="inline-block h-5 w-12 rounded bg-blue-100 dark:bg-blue-900/40 animate-pulse" />
                  ) : (
                    <DeterminismCell score={v.avgDeterminismScore} runCount={v.runCount} />
                  )}
                </td>
                {onSelectRun && (
                  <td className="px-5 py-4">
                    {isRunning && !hasData ? (
                      <div className="flex gap-1">
                        {[...Array(3)].map((_, i) => (
                          <span
                            key={i}
                            className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/40 animate-pulse"
                            style={{ animationDelay: `${i * 150}ms` }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {v.runs.slice(0, 5).map((r, i) => (
                          <button
                            key={r.runId}
                            onClick={() => onSelectRun(r, v.model, v.toolConfig)}
                            title={`Run ${i + 1}${r.hudTraceId ? ` — trace ${r.hudTraceId.slice(0, 8)}…` : ""}`}
                            className={`w-4 h-4 rounded-full border transition-transform hover:scale-125 cursor-pointer ${
                              r.success
                                ? "bg-emerald-400 border-emerald-500"
                                : "bg-red-400 border-red-500"
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

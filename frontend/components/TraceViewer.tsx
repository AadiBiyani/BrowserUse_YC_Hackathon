"use client";

import { useEffect } from "react";

type RunSummary = {
  runId: string;
  hudTraceId?: string;
  success: boolean;
  totalSteps: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  determinismScore?: number;
};

interface TraceViewerProps {
  run: RunSummary;
  model: string;
  toolConfig?: string;
  onClose: () => void;
}

const HUD_TRACE_BASE = "https://hud.ai/trace";

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}

const TOOL_CONFIG_LABELS: Record<string, string> = {
  full:            "Full toolkit",
  navigation_only: "Navigation only",
};

export function TraceViewer({ run, model, toolConfig, onClose }: TraceViewerProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div
              className={`w-2.5 h-2.5 rounded-full ${run.success ? "bg-emerald-400" : "bg-red-400"}`}
            />
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                {model}
              </h3>
              {toolConfig && toolConfig !== "full" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {TOOL_CONFIG_LABELS[toolConfig] ?? toolConfig}
                </p>
              )}
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                run.success
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
              }`}
            >
              {run.success ? "Success" : "Failure"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400 dark:text-slate-500"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stats */}
        <div className="px-6 py-2">
          <StatRow label="Steps taken" value={String(run.totalSteps)} />
          <StatRow label="Total cost" value={`$${run.totalCostUsd.toFixed(5)}`} />
          <StatRow label="Latency" value={`${(run.totalLatencyMs / 1000).toFixed(2)}s`} />
          {run.determinismScore !== undefined && (
            <StatRow
              label="Determinism score"
              value={`${(run.determinismScore * 100).toFixed(0)}%`}
            />
          )}
          {run.hudTraceId && (
            <StatRow label="Trace ID" value={`${run.hudTraceId.slice(0, 8)}…`} />
          )}
        </div>

        {/* Footer */}
        {run.hudTraceId && (
          <div className="px-6 pb-5 pt-2">
            <a
              href={`${HUD_TRACE_BASE}/${run.hudTraceId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white text-sm font-medium transition-colors shadow-sm"
            >
              View full trace on HUD
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

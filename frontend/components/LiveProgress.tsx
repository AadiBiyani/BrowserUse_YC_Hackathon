"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

interface LiveProgressProps {
  experimentId: Id<"experiments">;
}

type VariantStatus = "pending" | "running" | "success" | "failure";

const STATUS_CONFIG: Record<
  VariantStatus,
  { bg: string; border: string; label: string; labelColor: string; dotColor: string; pulse: boolean }
> = {
  pending: {
    bg:         "bg-slate-50 dark:bg-slate-800/60",
    border:     "border-slate-200 dark:border-slate-700",
    label:      "Pending",
    labelColor: "text-slate-500 dark:text-slate-400",
    dotColor:   "bg-slate-400",
    pulse:      false,
  },
  running: {
    bg:         "bg-blue-50 dark:bg-blue-900/20",
    border:     "border-blue-200 dark:border-blue-800",
    label:      "Running",
    labelColor: "text-blue-600 dark:text-blue-400",
    dotColor:   "bg-blue-400",
    pulse:      true,
  },
  success: {
    bg:         "bg-emerald-50 dark:bg-emerald-900/20",
    border:     "border-emerald-200 dark:border-emerald-800",
    label:      "Success",
    labelColor: "text-emerald-600 dark:text-emerald-400",
    dotColor:   "bg-emerald-400",
    pulse:      false,
  },
  failure: {
    bg:         "bg-red-50 dark:bg-red-900/20",
    border:     "border-red-200 dark:border-red-800",
    label:      "Failure",
    labelColor: "text-red-600 dark:text-red-400",
    dotColor:   "bg-red-400",
    pulse:      false,
  },
};

const MODEL_INITIALS: Record<string, string> = {
  "gpt-4o":            "G4",
  "claude-sonnet-4-5": "CS",
  "gemini-2.0-flash":  "Gm",
};

const MODEL_GRADIENT: Record<string, string> = {
  "gpt-4o":            "from-emerald-500 to-teal-500",
  "claude-sonnet-4-5": "from-violet-500 to-purple-600",
  "gemini-2.0-flash":  "from-blue-500 to-cyan-500",
};

export function LiveProgress({ experimentId }: LiveProgressProps) {
  const variants = useQuery(api.variants.listByExperiment, { experimentId });

  if (variants === undefined) {
    return (
      <div className="flex gap-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="flex-1 h-20 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (variants.length === 0) return null;

  const allDone = variants.every((v) => v.status === "success" || v.status === "failure");
  const anyRunning = variants.some((v) => v.status === "running");

  return (
    <div className="space-y-3">
      {(anyRunning || !allDone) && (
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {anyRunning ? (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              Experiment running — results will appear as each model completes
            </>
          ) : (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
              Waiting for run to start — make sure the backend is running on port 8000
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {variants.map((variant) => {
          const status = (variant.status ?? "pending") as VariantStatus;
          const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
          const initials = MODEL_INITIALS[variant.model] ?? variant.model.slice(0, 2).toUpperCase();
          const gradient = MODEL_GRADIENT[variant.model] ?? "from-slate-400 to-slate-500";

          return (
            <div
              key={variant._id}
              className={`rounded-xl border px-4 py-3.5 flex items-center gap-3 transition-all ${cfg.bg} ${cfg.border}`}
            >
              {/* Model avatar */}
              <div
                className={`w-9 h-9 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0`}
              >
                <span className="text-white text-[11px] font-bold">{initials}</span>
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {variant.model}
                </p>
                <div className={`flex items-center gap-1.5 mt-0.5 ${cfg.labelColor}`}>
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dotColor} ${
                      cfg.pulse ? "animate-pulse" : ""
                    }`}
                  />
                  <span className="text-xs font-medium">{cfg.label}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

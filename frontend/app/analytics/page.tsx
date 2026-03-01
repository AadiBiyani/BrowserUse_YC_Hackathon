"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  MetricBarChart,
  GroupedBarChart,
  RunScatterPlot,
  type BarDatum,
  type GroupedBarDatum,
  type ScatterDatum,
} from "@/components/AnalyticsCharts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ts: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber-400",
  running: "bg-blue-400 animate-pulse",
  completed: "bg-emerald-400",
  failed: "bg-red-400",
};

// ---------------------------------------------------------------------------
// Metrics hook — fetches for up to 6 selected experiments
// ---------------------------------------------------------------------------

function useMultiMetrics(ids: Id<"experiments">[]) {
  const m0 = useQuery(api.runs.getExperimentMetrics, ids[0] ? { experimentId: ids[0] } : "skip");
  const m1 = useQuery(api.runs.getExperimentMetrics, ids[1] ? { experimentId: ids[1] } : "skip");
  const m2 = useQuery(api.runs.getExperimentMetrics, ids[2] ? { experimentId: ids[2] } : "skip");
  const m3 = useQuery(api.runs.getExperimentMetrics, ids[3] ? { experimentId: ids[3] } : "skip");
  const m4 = useQuery(api.runs.getExperimentMetrics, ids[4] ? { experimentId: ids[4] } : "skip");
  const m5 = useQuery(api.runs.getExperimentMetrics, ids[5] ? { experimentId: ids[5] } : "skip");
  return [m0, m1, m2, m3, m4, m5] as const;
}

// ---------------------------------------------------------------------------
// Multi-select dropdown
// ---------------------------------------------------------------------------

type Experiment = { _id: Id<"experiments">; name: string; status: string; createdAt: number };

function ExperimentDropdown({
  experiments,
  selectedIds,
  onToggle,
  onClear,
}: {
  experiments: Experiment[] | undefined;
  selectedIds: Id<"experiments">[];
  onToggle: (id: Id<"experiments">) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedNames = (experiments ?? [])
    .filter((e) => selectedIds.includes(e._id))
    .map((e) => e.name);

  return (
    <div className="mb-8" ref={ref}>
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
        Select experiments to compare
        <span className="font-normal text-slate-400 dark:text-slate-500 ml-2">(up to 6)</span>
      </h2>

      {experiments === undefined ? (
        <div className="h-10 w-80 bg-slate-200 dark:bg-slate-800 rounded-lg animate-pulse" />
      ) : experiments.length === 0 ? (
        <p className="text-sm text-slate-400">
          No experiments yet.{" "}
          <Link href="/experiments/new" className="text-violet-600 hover:underline">
            Create one
          </Link>
        </p>
      ) : (
        <div className="relative w-full max-w-lg">
          {/* Trigger button */}
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-left transition-colors hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
          >
            <span className="truncate text-slate-600 dark:text-slate-400">
              {selectedNames.length === 0
                ? "Choose experiments..."
                : selectedNames.length <= 2
                  ? selectedNames.join(", ")
                  : `${selectedNames.length} experiments selected`}
            </span>
            <svg
              className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {/* Selected chips */}
          {selectedNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(experiments ?? [])
                .filter((e) => selectedIds.includes(e._id))
                .map((exp) => (
                  <span
                    key={exp._id}
                    className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-md bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 text-xs text-violet-700 dark:text-violet-300 font-medium"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[exp.status] ?? "bg-slate-300"}`} />
                    <span className="truncate max-w-[160px]">{exp.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggle(exp._id); }}
                      className="ml-0.5 p-0.5 rounded hover:bg-violet-200 dark:hover:bg-violet-800 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              <button
                onClick={onClear}
                className="text-[11px] text-slate-400 hover:text-red-500 transition-colors px-1.5 py-1"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Dropdown list */}
          {open && (
            <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
              {experiments.map((exp) => {
                const selected = selectedIds.includes(exp._id);
                const disabled = !selected && selectedIds.length >= 6;
                return (
                  <button
                    key={exp._id}
                    onClick={() => { if (!disabled) onToggle(exp._id); }}
                    disabled={disabled}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-left transition-colors ${
                      selected
                        ? "bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300"
                        : disabled
                          ? "opacity-40 cursor-not-allowed text-slate-400"
                          : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      selected
                        ? "bg-violet-600 border-violet-600"
                        : "border-slate-300 dark:border-slate-600"
                    }`}>
                      {selected && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      )}
                    </span>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[exp.status] ?? "bg-slate-300"}`} />
                    <span className="font-medium truncate">{exp.name}</span>
                    <span className="text-slate-400 dark:text-slate-500 font-normal ml-auto shrink-0">
                      {formatDate(exp.createdAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const experiments = useQuery(api.experiments.list);
  const [selectedIds, setSelectedIds] = useState<Id<"experiments">[]>([]);
  const metricsArr = useMultiMetrics(selectedIds);

  const experimentMap = useMemo(() => {
    const map: Record<string, { name: string; createdAt: number; status: string }> = {};
    for (const exp of experiments ?? []) {
      map[exp._id] = { name: exp.name, createdAt: exp.createdAt, status: exp.status };
    }
    return map;
  }, [experiments]);

  function toggleExperiment(id: Id<"experiments">) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 6 ? prev : [...prev, id]
    );
  }

  const isSingle = selectedIds.length === 1;
  const isMulti = selectedIds.length >= 2;

  // Build chart data
  const { singleBars, groupedData, allModels, scatterData, totalRuns, totalVariants } = useMemo(() => {
    const singleBars: {
      cost: BarDatum[];
      latency: BarDatum[];
      success: BarDatum[];
      steps: BarDatum[];
    } = { cost: [], latency: [], success: [], steps: [] };

    const groupedMap: {
      cost: Record<string, GroupedBarDatum>;
      latency: Record<string, GroupedBarDatum>;
      success: Record<string, GroupedBarDatum>;
      steps: Record<string, GroupedBarDatum>;
    } = { cost: {}, latency: {}, success: {}, steps: {} };

    const allModelsSet = new Set<string>();
    const scatter: ScatterDatum[] = [];
    let totalRuns = 0;
    let totalVariants = 0;

    selectedIds.forEach((expId, idx) => {
      const metrics = metricsArr[idx];
      if (!metrics) return;
      const expName = experimentMap[expId]?.name ?? expId.slice(0, 8);

      for (const v of metrics) {
        const label = isSingle
          ? `${v.model}${v.toolConfig !== "full" ? ` (${v.toolConfig})` : ""}`
          : `${v.model}`;
        allModelsSet.add(v.model);
        totalVariants++;
        totalRuns += v.runCount;

        if (isSingle) {
          singleBars.cost.push({ label, value: v.avgCostUsd, model: v.model });
          singleBars.latency.push({ label, value: v.avgLatencyMs / 1000, model: v.model });
          singleBars.success.push({ label, value: v.successRate * 100, model: v.model });
          singleBars.steps.push({ label, value: v.avgSteps, model: v.model });
        }

        if (isMulti) {
          for (const key of ["cost", "latency", "success", "steps"] as const) {
            if (!groupedMap[key][expName]) {
              groupedMap[key][expName] = { experiment: expName };
            }
          }
          groupedMap.cost[expName][v.model] = v.avgCostUsd;
          groupedMap.latency[expName][v.model] = v.avgLatencyMs / 1000;
          groupedMap.success[expName][v.model] = v.successRate * 100;
          groupedMap.steps[expName][v.model] = v.avgSteps;
        }

        for (const run of v.runs) {
          scatter.push({
            model: v.model,
            cost: run.totalCostUsd,
            latency: run.totalLatencyMs / 1000,
            success: run.success,
            experiment: expName,
          });
        }
      }
    });

    return {
      singleBars,
      groupedData: {
        cost: Object.values(groupedMap.cost),
        latency: Object.values(groupedMap.latency),
        success: Object.values(groupedMap.success),
        steps: Object.values(groupedMap.steps),
      },
      allModels: Array.from(allModelsSet),
      scatterData: scatter,
      totalRuns,
      totalVariants,
    };
  }, [selectedIds, metricsArr, experimentMap, isSingle, isMulti]);

  const hasData = selectedIds.length > 0 && (isSingle ? singleBars.cost.length > 0 : groupedData.cost.length > 0);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-400"
              aria-label="Back"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
            </Link>
            <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-md flex items-center justify-center">
                <span className="text-white text-[10px] font-bold">AL</span>
              </div>
              <span className="text-base font-bold text-slate-900 dark:text-slate-100">Analytics</span>
            </div>
          </div>
          {hasData && (
            <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
              <span>{selectedIds.length} experiment{selectedIds.length !== 1 && "s"}</span>
              <span>{totalVariants} variant{totalVariants !== 1 && "s"}</span>
              <span>{totalRuns} run{totalRuns !== 1 && "s"}</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Experiment picker dropdown */}
        <ExperimentDropdown
          experiments={experiments}
          selectedIds={selectedIds}
          onToggle={toggleExperiment}
          onClear={() => setSelectedIds([])}
        />

        {/* Empty state */}
        {selectedIds.length === 0 && (
          <div className="text-center py-24 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            <div className="w-16 h-16 bg-violet-50 dark:bg-violet-900/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
              </svg>
            </div>
            <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Select experiments above</h3>
            <p className="text-sm text-slate-400 dark:text-slate-500 max-w-sm mx-auto">
              Pick one experiment to compare its model variants, or select multiple to compare performance across tasks.
            </p>
          </div>
        )}

        {/* Loading state */}
        {selectedIds.length > 0 && !hasData && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-[320px] bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 animate-pulse" />
            ))}
          </div>
        )}

        {/* Single experiment charts */}
        {isSingle && hasData && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <MetricBarChart
                data={singleBars.cost}
                title="Average Cost per Run"
                unit="$"
                formatValue={(v) => `$${v.toFixed(4)}`}
              />
              <MetricBarChart
                data={singleBars.latency}
                title="Average Latency"
                unit="s"
                formatValue={(v) => `${v.toFixed(1)}s`}
              />
              <MetricBarChart
                data={singleBars.success}
                title="Success Rate"
                unit="%"
                formatValue={(v) => `${v.toFixed(0)}%`}
              />
              <MetricBarChart
                data={singleBars.steps}
                title="Average Steps"
                formatValue={(v) => v.toFixed(1)}
              />
            </div>
            <RunScatterPlot data={scatterData} />
          </>
        )}

        {/* Multi-experiment charts */}
        {isMulti && hasData && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <GroupedBarChart
                data={groupedData.cost}
                models={allModels}
                title="Average Cost per Run"
                formatValue={(v) => `$${v.toFixed(4)}`}
              />
              <GroupedBarChart
                data={groupedData.latency}
                models={allModels}
                title="Average Latency"
                formatValue={(v) => `${v.toFixed(1)}s`}
              />
              <GroupedBarChart
                data={groupedData.success}
                models={allModels}
                title="Success Rate"
                formatValue={(v) => `${v.toFixed(0)}%`}
              />
              <GroupedBarChart
                data={groupedData.steps}
                models={allModels}
                title="Average Steps"
                formatValue={(v) => v.toFixed(1)}
              />
            </div>
            <RunScatterPlot data={scatterData} />
          </>
        )}
      </main>
    </div>
  );
}

"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ZAxis,
  Cell,
} from "recharts";

const MODEL_COLORS: Record<string, string> = {
  "gpt-4o": "#10b981",
  "claude-sonnet-4-5": "#8b5cf6",
  "gemini-2.0-flash": "#3b82f6",
};

const FALLBACK_COLORS = ["#10b981", "#8b5cf6", "#3b82f6", "#f59e0b", "#ef4444", "#06b6d4"];

function getColor(model: string, index: number): string {
  return MODEL_COLORS[model] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

// ---------------------------------------------------------------------------
// MetricBarChart
// ---------------------------------------------------------------------------

export type BarDatum = {
  label: string;
  value: number;
  model: string;
  experiment?: string;
};

interface MetricBarChartProps {
  data: BarDatum[];
  title: string;
  unit?: string;
  formatValue?: (v: number) => string;
}

export function MetricBarChart({ data, title, unit = "", formatValue }: MetricBarChartProps) {
  const fmt = formatValue ?? ((v: number) => `${v.toFixed(2)}${unit}`);
  const fmtOrDash = (v: number | undefined) => (typeof v === "number" ? fmt(v) : "-");

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">{title}</h3>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-sm text-slate-400">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              className="text-slate-500 dark:text-slate-400"
              interval={0}
              angle={data.length > 4 ? -25 : 0}
              textAnchor={data.length > 4 ? "end" : "middle"}
              height={data.length > 4 ? 60 : 30}
            />
            <YAxis tick={{ fontSize: 11 }} className="text-slate-500 dark:text-slate-400" tickFormatter={(v) => fmt(v)} />
            <Tooltip
              formatter={(value: number | undefined) => [fmtOrDash(value), "Value"]}
              contentStyle={{
                backgroundColor: "var(--tooltip-bg, #fff)",
                border: "1px solid var(--tooltip-border, #e2e8f0)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
              {data.map((d, i) => (
                <Cell key={d.label} fill={getColor(d.model, i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouped bar chart for cross-experiment comparison
// ---------------------------------------------------------------------------

export type GroupedBarDatum = Record<string, string | number>;

interface GroupedBarChartProps {
  data: GroupedBarDatum[];
  models: string[];
  title: string;
  unit?: string;
  formatValue?: (v: number) => string;
}

export function GroupedBarChart({ data, models, title, unit = "", formatValue }: GroupedBarChartProps) {
  const fmt = formatValue ?? ((v: number) => `${v.toFixed(2)}${unit}`);
  const fmtOrDash = (v: number | undefined) => (typeof v === "number" ? fmt(v) : "-");

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">{title}</h3>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-sm text-slate-400">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
            <XAxis dataKey="experiment" tick={{ fontSize: 11 }} className="text-slate-500 dark:text-slate-400" />
            <YAxis tick={{ fontSize: 11 }} className="text-slate-500 dark:text-slate-400" tickFormatter={(v) => fmt(v)} />
            <Tooltip
              formatter={(value: number | undefined, name: string | undefined) => [fmtOrDash(value), name ?? "Value"]}
              contentStyle={{
                backgroundColor: "var(--tooltip-bg, #fff)",
                border: "1px solid var(--tooltip-border, #e2e8f0)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            {models.map((model, i) => (
              <Bar key={model} dataKey={model} fill={getColor(model, i)} radius={[4, 4, 0, 0]} maxBarSize={40} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunScatterPlot — cost vs latency per run
// ---------------------------------------------------------------------------

export type ScatterDatum = {
  model: string;
  cost: number;
  latency: number;
  success: boolean;
  experiment?: string;
};

interface RunScatterPlotProps {
  data: ScatterDatum[];
  title?: string;
}

export function RunScatterPlot({ data, title = "Cost vs Latency (per run)" }: RunScatterPlotProps) {
  const models = Array.from(new Set(data.map((d) => d.model)));

  const costPad = data.length > 0 ? Math.max(...data.map((d) => d.cost)) * 0.15 : 0;
  const latPad = data.length > 0 ? Math.max(...data.map((d) => d.latency)) * 0.15 : 0;
  const xDomain: [number, number] = [0, data.length > 0 ? Math.max(...data.map((d) => d.cost)) + costPad : 1];
  const yDomain: [number, number] = [0, data.length > 0 ? Math.max(...data.map((d) => d.latency)) + latPad : 1];

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">{title}</h3>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-sm text-slate-400">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={360}>
          <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
            <XAxis
              type="number"
              dataKey="cost"
              name="Cost"
              unit="$"
              domain={xDomain}
              tick={{ fontSize: 11 }}
              className="text-slate-500 dark:text-slate-400"
              label={{ value: "Cost ($)", position: "insideBottom", offset: -10, fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="latency"
              name="Latency"
              unit="s"
              domain={yDomain}
              tick={{ fontSize: 11 }}
              className="text-slate-500 dark:text-slate-400"
              label={{ value: "Latency (s)", angle: -90, position: "insideLeft", fontSize: 11 }}
            />
            <ZAxis range={[200, 200]} />
            <Tooltip
              formatter={(value: number | undefined, name: string | undefined) => {
                const label = name ?? "Value";
                if (typeof value !== "number") return ["-", label];
                if (label === "Cost") return [`$${value.toFixed(4)}`, label];
                if (label === "Latency") return [`${value.toFixed(1)}s`, label];
                return [value, label];
              }}
              contentStyle={{
                backgroundColor: "var(--tooltip-bg, #fff)",
                border: "1px solid var(--tooltip-border, #e2e8f0)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            {models.map((model, i) => (
              <Scatter
                key={model}
                name={model}
                data={data.filter((d) => d.model === model)}
                fill={getColor(model, i)}
                opacity={0.85}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

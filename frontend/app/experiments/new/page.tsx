"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const AVAILABLE_MODELS = [
  { id: "gpt-4o",             label: "GPT-4o",              provider: "OpenAI",    color: "emerald" },
  { id: "claude-sonnet-4-5",  label: "Claude Sonnet 4.5",   provider: "Anthropic", color: "violet" },
  { id: "gemini-2.0-flash",   label: "Gemini 2.0 Flash",    provider: "Google",    color: "blue" },
] as const;

const TOOL_CONFIGS = [
  {
    id: "full",
    label: "Full toolkit",
    description: "All browser tools: navigate, click, input, extract, scroll, screenshot, and more",
    color: "emerald",
  },
  {
    id: "navigation_only",
    label: "Navigation only",
    description: "Restricted to: navigate, click, input, extract — tests core task completion",
    color: "amber",
  },
] as const;

const COMPARE_MODES = [
  { value: "contains", label: "Contains — answer contains the expected text" },
  { value: "exact",    label: "Exact — case-insensitive exact match" },
  { value: "regex",    label: "Regex — expected is a regex pattern" },
];

type Step1 = {
  name: string;
  taskUrl: string;
  taskGoal: string;
  expected: string;
  compareMode: string;
};

type Step2 = {
  models: string[];
  group: number;
};

type Step3 = {
  toolConfigs: string[];
};

const STEP_LABELS = ["Task", "Models", "Tools", "Launch"];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEP_LABELS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                done
                  ? "bg-violet-600 text-white"
                  : active
                  ? "bg-violet-600 text-white ring-4 ring-violet-100 dark:ring-violet-900/40"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
              }`}
            >
              {done ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              ) : (
                step
              )}
            </div>
            <span
              className={`text-sm font-medium ${
                active
                  ? "text-slate-900 dark:text-slate-100"
                  : done
                  ? "text-violet-600 dark:text-violet-400"
                  : "text-slate-400 dark:text-slate-500"
              }`}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <div className={`w-8 h-px mx-1 ${done ? "bg-violet-300 dark:bg-violet-700" : "bg-slate-200 dark:bg-slate-700"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
      {children}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all"
    />
  );
}

// ── Step 1: Task configuration ────────────────────────────────────────────────

function Step1Form({
  data,
  onChange,
  onNext,
}: {
  data: Step1;
  onChange: (d: Step1) => void;
  onNext: () => void;
}) {
  const valid = data.name.trim() && data.taskUrl.trim() && data.taskGoal.trim();
  return (
    <div className="space-y-5">
      <div>
        <Label required>Experiment name</Label>
        <Input
          value={data.name}
          onChange={(v) => onChange({ ...data, name: v })}
          placeholder="e.g. Form fill comparison"
        />
      </div>

      <div>
        <Label required>Task URL</Label>
        <Input
          value={data.taskUrl}
          onChange={(v) => onChange({ ...data, taskUrl: v })}
          placeholder="https://httpbin.org/forms/post"
          type="url"
        />
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
          The starting URL the agent will navigate to.
        </p>
      </div>

      <div>
        <Label required>Task goal / prompt</Label>
        <textarea
          value={data.taskGoal}
          onChange={(e) => onChange({ ...data, taskGoal: e.target.value })}
          rows={3}
          placeholder="Fill in the form with customer name 'Test User', telephone '555-1234', email 'test@example.com', select Medium pizza size, then submit. Return the response body."
          className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Expected answer (optional)</Label>
          <Input
            value={data.expected}
            onChange={(v) => onChange({ ...data, expected: v })}
            placeholder="Test User"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            Text the agent&apos;s final answer should contain to pass.
          </p>
        </div>
        <div>
          <Label>Compare mode</Label>
          <select
            value={data.compareMode}
            onChange={(e) => onChange({ ...data, compareMode: e.target.value })}
            className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all"
          >
            {COMPARE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="pt-2 flex justify-end">
        <button
          onClick={onNext}
          disabled={!valid}
          className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors shadow-sm"
        >
          Next: Models
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Model selection ───────────────────────────────────────────────────

const COLOR_MAP: Record<string, { ring: string; bg: string; text: string; dot: string }> = {
  emerald: {
    ring: "ring-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-400",
  },
  violet: {
    ring: "ring-violet-500",
    bg: "bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800",
    text: "text-violet-700 dark:text-violet-300",
    dot: "bg-violet-400",
  },
  blue: {
    ring: "ring-blue-500",
    bg: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
    text: "text-blue-700 dark:text-blue-300",
    dot: "bg-blue-400",
  },
  amber: {
    ring: "ring-amber-500",
    bg: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
    text: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-400",
  },
};

function Step2Form({
  data,
  onChange,
  onBack,
  onNext,
}: {
  data: Step2;
  onChange: (d: Step2) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const valid = data.models.length >= 1;

  function toggleModel(id: string) {
    onChange({
      ...data,
      models: data.models.includes(id)
        ? data.models.filter((m) => m !== id)
        : [...data.models, id],
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Label required>Select models to compare</Label>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          Each selected model runs the same task {data.group}× for statistical significance.
        </p>
        <div className="grid grid-cols-1 gap-3">
          {AVAILABLE_MODELS.map((m) => {
            const selected = data.models.includes(m.id);
            const c = COLOR_MAP[m.color];
            return (
              <button
                key={m.id}
                onClick={() => toggleModel(m.id)}
                className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border-2 transition-all text-left ${
                  selected
                    ? `${c.bg} border-current ${c.text} ring-2 ${c.ring} ring-offset-1 dark:ring-offset-slate-900`
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded flex items-center justify-center border-2 flex-shrink-0 transition-colors ${
                    selected
                      ? `${c.dot.replace("bg-", "bg-").replace("400", "500")} border-current`
                      : "border-slate-300 dark:border-slate-600"
                  }`}
                >
                  {selected && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className={`font-semibold text-sm ${selected ? "" : "text-slate-800 dark:text-slate-200"}`}>
                    {m.label}
                  </p>
                  <p className={`text-xs ${selected ? "opacity-70" : "text-slate-400 dark:text-slate-500"}`}>
                    {m.provider}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Runs per model: {data.group}</Label>
        <input
          type="range"
          min={1}
          max={5}
          value={data.group}
          onChange={(e) => onChange({ ...data, group: parseInt(e.target.value) })}
          className="w-full accent-violet-600 mt-1"
        />
        <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500 mt-1">
          <span>1 (fast)</span>
          <span>3 (recommended)</span>
          <span>5 (high confidence)</span>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
          Total runs: {data.models.length} models × {data.group} = <strong className="text-slate-600 dark:text-slate-300">{data.models.length * data.group}</strong>
        </p>
      </div>

      <div className="pt-2 flex justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!valid}
          className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors shadow-sm"
        >
          Review
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Tool config selection ────────────────────────────────────────────

function Step3Form({
  data,
  onChange,
  onBack,
  onNext,
  modelCount,
  group,
}: {
  data: Step3;
  onChange: (d: Step3) => void;
  onBack: () => void;
  onNext: () => void;
  modelCount: number;
  group: number;
}) {
  const valid = data.toolConfigs.length >= 1;

  function toggleConfig(id: string) {
    onChange({
      ...data,
      toolConfigs: data.toolConfigs.includes(id)
        ? data.toolConfigs.filter((c) => c !== id)
        : [...data.toolConfigs, id],
    });
  }

  const totalRuns = modelCount * data.toolConfigs.length * group;

  return (
    <div className="space-y-6">
      <div>
        <Label required>Select tool configurations</Label>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          Each configuration runs with every selected model. Comparing tool configs reveals how
          capability restrictions affect agent performance.
        </p>
        <div className="grid grid-cols-1 gap-3">
          {TOOL_CONFIGS.map((tc) => {
            const selected = data.toolConfigs.includes(tc.id);
            const c = COLOR_MAP[tc.color];
            return (
              <button
                key={tc.id}
                onClick={() => toggleConfig(tc.id)}
                className={`flex items-start gap-4 px-4 py-4 rounded-xl border-2 transition-all text-left ${
                  selected
                    ? `${c.bg} border-current ${c.text} ring-2 ${c.ring} ring-offset-1 dark:ring-offset-slate-900`
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded flex items-center justify-center border-2 flex-shrink-0 mt-0.5 transition-colors ${
                    selected
                      ? `${c.dot.replace("bg-", "bg-").replace("400", "500")} border-current`
                      : "border-slate-300 dark:border-slate-600"
                  }`}
                >
                  {selected && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className={`font-semibold text-sm ${selected ? "" : "text-slate-800 dark:text-slate-200"}`}>
                    {tc.label}
                  </p>
                  <p className={`text-xs mt-0.5 ${selected ? "opacity-70" : "text-slate-400 dark:text-slate-500"}`}>
                    {tc.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Total runs: {modelCount} models × {data.toolConfigs.length} tool configs × {group} ={" "}
        <strong className="text-slate-600 dark:text-slate-300">{totalRuns}</strong>
      </p>

      <div className="pt-2 flex justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!valid}
          className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors shadow-sm"
        >
          Review
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Review & Launch ───────────────────────────────────────────────────

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-slate-100 dark:border-slate-800 last:border-0 gap-4">
      <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-slate-900 dark:text-slate-100 text-right">{value}</span>
    </div>
  );
}

function Step4Review({
  step1,
  step2,
  step3,
  onBack,
  onLaunch,
  isLaunching,
}: {
  step1: Step1;
  step2: Step2;
  step3: Step3;
  onBack: () => void;
  onLaunch: () => void;
  isLaunching: boolean;
}) {
  const selectedModelLabels = step2.models
    .map((id) => AVAILABLE_MODELS.find((m) => m.id === id)?.label ?? id)
    .join(", ");
  const selectedToolLabels = step3.toolConfigs
    .map((id) => TOOL_CONFIGS.find((t) => t.id === id)?.label ?? id)
    .join(", ");
  const totalRuns = step2.models.length * step3.toolConfigs.length * step2.group;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 divide-y divide-slate-100 dark:divide-slate-800">
        <ReviewRow label="Name" value={step1.name} />
        <ReviewRow label="URL" value={<span className="font-mono text-xs break-all">{step1.taskUrl}</span>} />
        <ReviewRow label="Goal" value={<span className="text-xs leading-relaxed text-right max-w-xs">{step1.taskGoal}</span>} />
        {step1.expected && <ReviewRow label="Expected answer" value={step1.expected} />}
        <ReviewRow label="Compare mode" value={step1.compareMode} />
        <ReviewRow label="Models" value={selectedModelLabels} />
        <ReviewRow label="Tool configs" value={selectedToolLabels} />
        <ReviewRow
          label="Total runs"
          value={
            <span className="font-semibold text-violet-600 dark:text-violet-400">
              {step2.models.length} × {step3.toolConfigs.length} configs × {step2.group} = {totalRuns}
            </span>
          }
        />
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
        <strong>Note:</strong> The backend FastAPI server must be running on port 8000 to execute HUD evals.
        Start it with <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">cd backend &amp;&amp; uvicorn api:app --reload --port 8000</code>
      </div>

      <div className="pt-2 flex justify-between">
        <button
          onClick={onBack}
          disabled={isLaunching}
          className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-colors disabled:opacity-40"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>
        <button
          onClick={onLaunch}
          disabled={isLaunching}
          className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors shadow-sm"
        >
          {isLaunching ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
              Launching…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
              </svg>
              Launch Experiment
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NewExperimentPage() {
  const router = useRouter();
  const createExperiment = useMutation(api.experiments.create);
  const createVariant = useMutation(api.variants.create);

  const [step, setStep] = useState(1);
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [step1, setStep1] = useState<Step1>({
    name: "",
    taskUrl: "",
    taskGoal: "",
    expected: "",
    compareMode: "contains",
  });

  const [step2, setStep2] = useState<Step2>({
    models: ["gpt-4o", "claude-sonnet-4-5"],
    group: 3,
  });

  const [step3, setStep3] = useState<Step3>({
    toolConfigs: ["full"],
  });

  async function handleLaunch() {
    setIsLaunching(true);
    setError(null);
    try {
      // Build the Cartesian product of models × tool configs
      const variantSpecs = step2.models.flatMap((model) =>
        step3.toolConfigs.map((toolConfig) => ({ model, tool_config: toolConfig }))
      );

      // 1. Create experiment in Convex
      const experimentId = await createExperiment({
        name: step1.name,
        taskGoal: step1.taskGoal,
        taskUrl: step1.taskUrl,
        successConditions: step1.expected ? [`Answer contains "${step1.expected}"`] : [],
      });

      // 2. Create a variant record for each (model, toolConfig) combination
      await Promise.all(
        variantSpecs.map(({ model, tool_config }) =>
          createVariant({
            experimentId,
            model,
            toolConfig: tool_config,
            architecture: "single_agent",
          })
        )
      );

      // 3. Kick off the HUD experiment run on the backend (non-blocking)
      const res = await fetch(`${API_URL}/run-experiment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experiment_id: experimentId,
          task: {
            url: step1.taskUrl,
            prompt: step1.taskGoal,
            expected: step1.expected || undefined,
            compare_mode: step1.compareMode,
          },
          variant_specs: variantSpecs,
          group: step2.group,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `API error ${res.status}`);
      }

      // 4. Redirect to the live experiment page
      router.push(`/experiments/${experimentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsLaunching(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-3">
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
            <span className="text-base font-bold text-slate-900 dark:text-slate-100">New Experiment</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <StepIndicator current={step} />

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
          {step === 1 && (
            <Step1Form data={step1} onChange={setStep1} onNext={() => setStep(2)} />
          )}
          {step === 2 && (
            <Step2Form
              data={step2}
              onChange={setStep2}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <Step3Form
              data={step3}
              onChange={setStep3}
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
              modelCount={step2.models.length}
              group={step2.group}
            />
          )}
          {step === 4 && (
            <Step4Review
              step1={step1}
              step2={step2}
              step3={step3}
              onBack={() => setStep(3)}
              onLaunch={handleLaunch}
              isLaunching={isLaunching}
            />
          )}

          {error && (
            <div className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

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

const TASK_MODES = [
  {
    id: "simple",
    label: "Simple (compatibility mode)",
    description: "Use URL + prompt + expected answer. Runs through scenario=answer.",
  },
  {
    id: "advanced",
    label: "Advanced (scenario mode)",
    description: "Use scenario + JSON scenarioArgs + optional task metadata.",
  },
] as const;

const SCENARIO_OPTIONS = ["answer", "task", "multi_step", "branching_goal", "wiki-game"] as const;

type Step1 = {
  name: string;
  taskMode: "simple" | "advanced";
  selectedTaskId: string | null; // null = create new task
  taskUrl: string;
  taskGoal: string;
  expected: string;
  compareMode: string;
  scenario: string;
  scenarioArgsText: string;
  taskIdMeta: string;
  externalId: string;
  difficulty: string;
  category: string;
  successConditionsText: string;
  maxSteps: string;
  timeoutSec: string;
  maxAttempts: string;
  retryDelaySec: string;
  retryTransientOnly: boolean;
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

type TaskRecord = {
  _id: string;
  name: string;
  url: string;
  goal: string;
  expected?: string;
  compareMode: string;
  taskMode?: string;
  taskPayload?: string;
};

type AdvancedTaskPayload = {
  scenario: string;
  scenarioArgsText: string;
  taskIdMeta?: string;
  externalId?: string;
  difficulty?: string;
  category?: string;
  successConditionsText?: string;
  maxSteps?: string;
  timeoutSec?: string;
  maxAttempts?: string;
  retryDelaySec?: string;
  retryTransientOnly?: boolean;
};

function createDefaultStep1(name = "", taskMode: "simple" | "advanced" = "simple"): Step1 {
  return {
    name,
    taskMode,
    selectedTaskId: null,
    taskUrl: "",
    taskGoal: "",
    expected: "",
    compareMode: "contains",
    scenario: "answer",
    scenarioArgsText: JSON.stringify(
      {
        url: "",
        prompt: "",
        expected: "",
        compare_mode: "contains",
      },
      null,
      2
    ),
    taskIdMeta: "",
    externalId: "",
    difficulty: "",
    category: "",
    successConditionsText: "",
    maxSteps: "",
    timeoutSec: "",
    maxAttempts: "",
    retryDelaySec: "",
    retryTransientOnly: true,
  };
}

function applyTaskRecordToStep1(base: Step1, task: TaskRecord): Step1 {
  const isAdvanced = task.taskMode === "advanced";
  if (isAdvanced && task.taskPayload) {
    try {
      const payload = JSON.parse(task.taskPayload) as AdvancedTaskPayload;
      return {
        ...base,
        selectedTaskId: task._id,
        taskMode: "advanced",
        taskUrl: task.url,
        taskGoal: task.goal,
        expected: task.expected ?? "",
        compareMode: task.compareMode,
        scenario: payload.scenario || "answer",
        scenarioArgsText: payload.scenarioArgsText || base.scenarioArgsText,
        taskIdMeta: payload.taskIdMeta || "",
        externalId: payload.externalId || "",
        difficulty: payload.difficulty || "",
        category: payload.category || "",
        successConditionsText: payload.successConditionsText || "",
        maxSteps: payload.maxSteps || "",
        timeoutSec: payload.timeoutSec || "",
        maxAttempts: payload.maxAttempts || "",
        retryDelaySec: payload.retryDelaySec || "",
        retryTransientOnly: payload.retryTransientOnly ?? true,
      };
    } catch {
      // Fall back to simple hydration if a legacy/invalid payload is encountered.
    }
  }

  return {
    ...base,
    selectedTaskId: task._id,
    taskMode: "simple",
    taskUrl: task.url,
    taskGoal: task.goal,
    expected: task.expected ?? "",
    compareMode: task.compareMode,
  };
}

function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalFloat(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSuccessConditions(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function Step1Form({
  data,
  onChange,
  onNext,
  tasks,
}: {
  data: Step1;
  onChange: (d: Step1) => void;
  onNext: () => void;
  tasks: TaskRecord[] | undefined;
}) {
  const isSimpleMode = data.taskMode === "simple";
  const isExisting = data.selectedTaskId !== null;
  const hasValidScenarioArgsJson = (() => {
    if (isSimpleMode) return true;
    try {
      const parsed = JSON.parse(data.scenarioArgsText);
      return !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
    } catch {
      return false;
    }
  })();
  const valid = isSimpleMode
    ? !!(data.name.trim() && data.taskUrl.trim() && data.taskGoal.trim())
    : !!(data.name.trim() && data.scenario.trim() && hasValidScenarioArgsJson);

  function handleTaskSelect(taskId: string) {
    if (taskId === "__new__") {
      onChange({ ...createDefaultStep1(data.name, data.taskMode), selectedTaskId: null });
      return;
    }
    const task = tasks?.find((t) => t._id === taskId);
    if (!task) return;
    onChange(applyTaskRecordToStep1(data, task));
  }

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
        <Label required>Task mode</Label>
        <div className="grid grid-cols-1 gap-2">
          {TASK_MODES.map((mode) => {
            const selected = data.taskMode === mode.id;
            return (
              <button
                key={mode.id}
                onClick={() =>
                  onChange({
                    ...data,
                    taskMode: mode.id,
                  })
                }
                className={`text-left rounded-xl border px-3.5 py-3 transition-colors ${
                  selected
                    ? "border-violet-400 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                }`}
              >
                <p className="text-sm font-semibold">{mode.label}</p>
                <p className="text-xs mt-0.5 opacity-80">{mode.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label required>Task</Label>
        <select
          value={data.selectedTaskId ?? "__new__"}
          onChange={(e) => handleTaskSelect(e.target.value)}
          className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all"
        >
          <option value="__new__">+ Create new task</option>
          {(tasks ?? []).map((t) => (
            <option key={t._id} value={t._id}>
              {t.name}{t.taskMode === "advanced" ? " (advanced)" : ""}
            </option>
          ))}
        </select>
        {isExisting && (
          <p className="text-xs text-violet-500 dark:text-violet-400 mt-1">
            Loaded saved task.
          </p>
        )}
      </div>

      {isSimpleMode ? (
        <>
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

      {!isExisting && data.taskUrl.trim() && data.taskGoal.trim() && (
        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 py-2.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            This task will be saved for reuse in future experiments.
          </p>
        </div>
      )}
        </>
      ) : (
        <>
          <div>
            <Label required>Scenario</Label>
            <select
              value={data.scenario}
              onChange={(e) => onChange({ ...data, scenario: e.target.value })}
              className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all"
            >
              {SCENARIO_OPTIONS.map((scenario) => (
                <option key={scenario} value={scenario}>
                  {scenario}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label required>Scenario args (JSON object)</Label>
            <textarea
              value={data.scenarioArgsText}
              onChange={(e) => onChange({ ...data, scenarioArgsText: e.target.value })}
              rows={10}
              placeholder={`{\n  "url": "https://httpbin.org/forms/post",\n  "prompt": "Fill the form and return confirmation.",\n  "expected": "TraceIQ Test",\n  "compare_mode": "contains"\n}`}
              className="w-full font-mono text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all resize-y"
            />
            {!hasValidScenarioArgsJson && (
              <p className="text-xs text-red-500 mt-1">Scenario args must be valid JSON object syntax.</p>
            )}
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              This is sent directly as `task.scenarioArgs` to `/run-experiment`.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Task ID (optional)</Label>
              <Input value={data.taskIdMeta} onChange={(v) => onChange({ ...data, taskIdMeta: v })} placeholder="canary_python_profile_dual_fact" />
            </div>
            <div>
              <Label>External ID (optional)</Label>
              <Input value={data.externalId} onChange={(v) => onChange({ ...data, externalId: v })} placeholder="0001" />
            </div>
            <div>
              <Label>Difficulty (optional)</Label>
              <Input value={data.difficulty} onChange={(v) => onChange({ ...data, difficulty: v })} placeholder="medium" />
            </div>
            <div>
              <Label>Category (optional)</Label>
              <Input value={data.category} onChange={(v) => onChange({ ...data, category: v })} placeholder="multi_step_extraction" />
            </div>
          </div>

          <div>
            <Label>Success conditions (optional, one per line)</Label>
            <textarea
              value={data.successConditionsText}
              onChange={(e) => onChange({ ...data, successConditionsText: e.target.value })}
              rows={4}
              placeholder={"response contains 'foo'\nresponse contains 'bar'"}
              className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Max steps (optional)</Label>
              <Input value={data.maxSteps} onChange={(v) => onChange({ ...data, maxSteps: v })} placeholder="20" type="number" />
            </div>
            <div>
              <Label>Timeout sec (optional)</Label>
              <Input value={data.timeoutSec} onChange={(v) => onChange({ ...data, timeoutSec: v })} placeholder="180" type="number" />
            </div>
            <div>
              <Label>Max attempts (optional)</Label>
              <Input value={data.maxAttempts} onChange={(v) => onChange({ ...data, maxAttempts: v })} placeholder="2" type="number" />
            </div>
            <div>
              <Label>Retry delay sec (optional)</Label>
              <Input value={data.retryDelaySec} onChange={(v) => onChange({ ...data, retryDelaySec: v })} placeholder="2.0" type="number" />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3.5 py-2.5">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={data.retryTransientOnly}
                onChange={(e) => onChange({ ...data, retryTransientOnly: e.target.checked })}
                className="accent-violet-600"
              />
              Retry transient errors only
            </label>
          </div>
        </>
      )}

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
  const isSimpleMode = step1.taskMode === "simple";
  const successConditions = parseSuccessConditions(step1.successConditionsText);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 divide-y divide-slate-100 dark:divide-slate-800">
        <ReviewRow label="Name" value={step1.name} />
        <ReviewRow label="Task mode" value={isSimpleMode ? "simple (compatibility)" : "advanced (scenario)"} />
        {isSimpleMode ? (
          <>
            <ReviewRow label="URL" value={<span className="font-mono text-xs break-all">{step1.taskUrl}</span>} />
            <ReviewRow label="Goal" value={<span className="text-xs leading-relaxed text-right max-w-xs">{step1.taskGoal}</span>} />
            {step1.expected && <ReviewRow label="Expected answer" value={step1.expected} />}
            <ReviewRow label="Compare mode" value={step1.compareMode} />
          </>
        ) : (
          <>
            <ReviewRow label="Scenario" value={step1.scenario} />
            <ReviewRow
              label="Scenario args"
              value={<span className="font-mono text-xs leading-relaxed text-right max-w-xs break-words">{step1.scenarioArgsText}</span>}
            />
            {step1.taskIdMeta && <ReviewRow label="Task ID" value={step1.taskIdMeta} />}
            {step1.externalId && <ReviewRow label="External ID" value={step1.externalId} />}
            {step1.difficulty && <ReviewRow label="Difficulty" value={step1.difficulty} />}
            {step1.category && <ReviewRow label="Category" value={step1.category} />}
            {successConditions.length > 0 && (
              <ReviewRow
                label="Success conditions"
                value={<span className="text-xs leading-relaxed text-right max-w-xs">{successConditions.join(" | ")}</span>}
              />
            )}
            {step1.maxSteps && <ReviewRow label="Max steps" value={step1.maxSteps} />}
            {step1.timeoutSec && <ReviewRow label="Timeout sec" value={step1.timeoutSec} />}
            {step1.maxAttempts && <ReviewRow label="Max attempts" value={step1.maxAttempts} />}
            {step1.retryDelaySec && <ReviewRow label="Retry delay sec" value={step1.retryDelaySec} />}
            <ReviewRow label="Retry transient only" value={step1.retryTransientOnly ? "true" : "false"} />
          </>
        )}
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

function NewExperimentPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromId = searchParams.get("from");

  const createExperiment = useMutation(api.experiments.create);
  const createVariant = useMutation(api.variants.create);
  const createTask = useMutation(api.tasks.create);

  const tasks = useQuery(api.tasks.list);
  const sourceExperiment = useQuery(
    api.experiments.get,
    fromId ? { id: fromId as Id<"experiments"> } : "skip"
  );
  const sourceVariants = useQuery(
    api.variants.listByExperiment,
    fromId ? { experimentId: fromId as Id<"experiments"> } : "skip"
  );

  const [step, setStep] = useState(1);
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefilled = useRef(false);

  const [step1, setStep1] = useState<Step1>(createDefaultStep1());

  const [step2, setStep2] = useState<Step2>({
    models: ["gpt-4o", "claude-sonnet-4-5"],
    group: 3,
  });

  const [step3, setStep3] = useState<Step3>({
    toolConfigs: ["full"],
  });

  useEffect(() => {
    if (prefilled.current || !sourceExperiment || !sourceVariants) return;
    const taskList = tasks as TaskRecord[] | undefined;
    if (sourceExperiment.taskId && !taskList) return;
    prefilled.current = true;

    const models = [...new Set(sourceVariants.map((v) => v.model))];
    const toolConfigs = [...new Set(sourceVariants.map((v) => v.toolConfig))];
    const expectedText = sourceExperiment.successConditions?.[0]
      ?.replace(/^Answer contains "/, "")
      .replace(/"$/, "") ?? "";

    const base = createDefaultStep1(`${sourceExperiment.name} (copy)`);
    if (sourceExperiment.taskId && taskList) {
      const sourceTask = taskList.find((task) => task._id === sourceExperiment.taskId);
      if (sourceTask) {
        setStep1({
          ...applyTaskRecordToStep1(base, sourceTask),
          name: `${sourceExperiment.name} (copy)`,
        });
      } else {
        setStep1({
          ...base,
          selectedTaskId: sourceExperiment.taskId ?? null,
          taskUrl: sourceExperiment.taskUrl,
          taskGoal: sourceExperiment.taskGoal,
          expected: expectedText,
          compareMode: "contains",
          scenarioArgsText: JSON.stringify(
            {
              url: sourceExperiment.taskUrl,
              prompt: sourceExperiment.taskGoal,
              expected: expectedText,
              compare_mode: "contains",
            },
            null,
            2
          ),
          successConditionsText: (sourceExperiment.successConditions ?? []).join("\n"),
        });
      }
    } else {
      setStep1({
        ...base,
        taskUrl: sourceExperiment.taskUrl,
        taskGoal: sourceExperiment.taskGoal,
        expected: expectedText,
        compareMode: "contains",
        scenarioArgsText: JSON.stringify(
          {
            url: sourceExperiment.taskUrl,
            prompt: sourceExperiment.taskGoal,
            expected: expectedText,
            compare_mode: "contains",
          },
          null,
          2
        ),
        successConditionsText: (sourceExperiment.successConditions ?? []).join("\n"),
      });
    }
    setStep2({ models: models.length > 0 ? models : ["gpt-4o"], group: 3 });
    setStep3({ toolConfigs: toolConfigs.length > 0 ? toolConfigs : ["full"] });
  }, [sourceExperiment, sourceVariants, tasks]);

  async function handleLaunch() {
    setIsLaunching(true);
    setError(null);
    try {
      const variantSpecs = step2.models.flatMap((model) =>
        step3.toolConfigs.map((toolConfig) => ({ model, tool_config: toolConfig }))
      );

      const isSimpleMode = step1.taskMode === "simple";
      let scenarioArgsFromAdvanced: Record<string, unknown> | null = null;
      if (!isSimpleMode) {
        try {
          const parsed = JSON.parse(step1.scenarioArgsText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Scenario args must be a JSON object");
          }
          scenarioArgsFromAdvanced = parsed as Record<string, unknown>;
        } catch (jsonErr) {
          throw new Error(
            `Invalid scenario args JSON: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`
          );
        }
      }

      const successConditions = isSimpleMode
        ? step1.expected
          ? [`Answer contains "${step1.expected}"`]
          : []
        : parseSuccessConditions(step1.successConditionsText);

      const derivedTaskUrl = isSimpleMode
        ? step1.taskUrl
        : typeof scenarioArgsFromAdvanced?.url === "string"
        ? scenarioArgsFromAdvanced.url
        : "";
      const derivedTaskGoal = isSimpleMode
        ? step1.taskGoal
        : typeof scenarioArgsFromAdvanced?.prompt === "string"
        ? scenarioArgsFromAdvanced.prompt
        : `Scenario: ${step1.scenario}`;

      let taskId: Id<"tasks"> | undefined;
      if (step1.selectedTaskId) {
        taskId = step1.selectedTaskId as Id<"tasks">;
      } else if (isSimpleMode) {
        taskId = await createTask({
          name: step1.name,
          url: step1.taskUrl,
          goal: step1.taskGoal,
          expected: step1.expected || undefined,
          compareMode: step1.compareMode,
          taskMode: "simple",
        });
      } else {
        const advancedTaskPayload: AdvancedTaskPayload = {
          scenario: step1.scenario,
          scenarioArgsText: step1.scenarioArgsText,
          taskIdMeta: step1.taskIdMeta || undefined,
          externalId: step1.externalId || undefined,
          difficulty: step1.difficulty || undefined,
          category: step1.category || undefined,
          successConditionsText: step1.successConditionsText || undefined,
          maxSteps: step1.maxSteps || undefined,
          timeoutSec: step1.timeoutSec || undefined,
          maxAttempts: step1.maxAttempts || undefined,
          retryDelaySec: step1.retryDelaySec || undefined,
          retryTransientOnly: step1.retryTransientOnly,
        };
        taskId = await createTask({
          name: step1.name,
          url: derivedTaskUrl,
          goal: derivedTaskGoal,
          expected: undefined,
          compareMode: "contains",
          taskMode: "advanced",
          taskPayload: JSON.stringify(advancedTaskPayload),
        });
      }

      const experimentId = await createExperiment({
        name: step1.name,
        taskGoal: derivedTaskGoal,
        taskUrl: derivedTaskUrl,
        successConditions,
        taskId,
      });

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

      const res = await fetch(`${API_URL}/run-experiment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experiment_id: experimentId,
          task: isSimpleMode
            ? {
                url: step1.taskUrl,
                prompt: step1.taskGoal,
                expected: step1.expected || undefined,
                compare_mode: step1.compareMode,
              }
            : {
                scenario: step1.scenario,
                scenarioArgs: scenarioArgsFromAdvanced,
                taskId: step1.taskIdMeta || undefined,
                externalId: step1.externalId || undefined,
                difficulty: step1.difficulty || undefined,
                category: step1.category || undefined,
                successConditions: successConditions.length > 0 ? successConditions : undefined,
                maxSteps: parseOptionalInt(step1.maxSteps),
                timeoutSec: parseOptionalInt(step1.timeoutSec),
                maxAttempts: parseOptionalInt(step1.maxAttempts),
                retryDelaySec: parseOptionalFloat(step1.retryDelaySec),
                retryTransientOnly: step1.retryTransientOnly,
              },
          variant_specs: variantSpecs,
          group: step2.group,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `API error ${res.status}`);
      }

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
              <span className="text-white text-[10px] font-bold">TI</span>
            </div>
            <span className="text-base font-bold text-slate-900 dark:text-slate-100">New Experiment</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <StepIndicator current={step} />

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 shadow-sm">
          {step === 1 && (
            <Step1Form data={step1} onChange={setStep1} onNext={() => setStep(2)} tasks={tasks as TaskRecord[] | undefined} />
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

export default function NewExperimentPage() {
  return (
    <Suspense>
      <NewExperimentPageInner />
    </Suspense>
  );
}

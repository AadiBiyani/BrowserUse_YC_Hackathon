"""
hud_runner.py — Seed eval: fire tasks against the deployed browser-use HUD environment.

Connects to the already-deployed environment at:
  hud.ai/environments/98905607-59c6-4f38-a176-43f7b5944a0f

Runs the built-in `answer` scenario (httpbin form fill) across 3 models × group=3 = 9 total runs.
Saves trace IDs and results to backend/runs/seed_traces_raw.json.

Usage:
    cd backend
    uv run python hud_runner.py
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import hud
from hud import Environment
from hud.agents import create_agent
from dotenv import load_dotenv

load_dotenv()

# ── Config ─────────────────────────────────────────────────────────────────

HUB_ENV = "traceiq-browser-env"  # deployed at hud.ai/environments/36bee7f9-3184-4e29-88b4-05e27d712c3e

MODELS = ["gpt-4o", "claude-sonnet-4-5", "gemini-2.0-flash"]
GROUP = 3  # runs per model → 9 total
SUCCESS_REWARD_THRESHOLD = float(os.getenv("SUCCESS_REWARD_THRESHOLD", "0.5"))

# Task: fill httpbin form — deterministic, no auth, 3 verifiable fields
TASK_URL = "https://httpbin.org/forms/post"
TASK_PROMPT = (
    "Fill in the form: set customer name to 'Trace.IQ Test', "
    "telephone to '555-1234', email to 'test@traceiq.dev', "
    "select 'Medium' for pizza size, then submit. "
    "Return the response body confirming submission."
)
TASK_EXPECTED = "Trace.IQ Test"
TASK_COMPARE_MODE = "contains"

OUT_DIR = Path(__file__).parent / "runs"
OUT_FILE = OUT_DIR / "seed_traces_raw.json"


# ── Main ───────────────────────────────────────────────────────────────────

async def main() -> None:
    print("[hud_runner] Connecting to deployed environment…")
    env = Environment("traceiq-browser-env").connect_hub(HUB_ENV)

    task = env(
        "answer",
        url=TASK_URL,
        prompt=TASK_PROMPT,
        expected=TASK_EXPECTED,
        compare_mode=TASK_COMPARE_MODE,
    )

    print(f"[hud_runner] Firing {len(MODELS)} models × group={GROUP} = {len(MODELS) * GROUP} runs…\n")

    async with hud.eval(task, variants={"model": MODELS}, group=GROUP) as ctx:
        model = ctx.variants["model"]
        agent = create_agent(model)
        await agent.run(ctx)

    # ── Results ────────────────────────────────────────────────────────────

    results_log: list[dict] = []
    print("── Results ──────────────────────────────────────────────────────")
    for r in ctx.results:
        model_name = r.variants.get("model", "unknown")
        reward = r.reward or 0.0
        status = "✓" if reward >= SUCCESS_REWARD_THRESHOLD else "✗"
        err = f"  err={r.error}" if r.error else ""
        print(f"  {status}  {model_name:38s}  reward={reward}  trace={r.trace_id}{err}")
        results_log.append({
            "trace_id": r.trace_id,
            "model": model_name,
            "reward": reward,
            "answer": r.answer,
            "variants": r.variants,
            "error": str(r.error) if r.error else None,
        })

    # ── Per-model summary ──────────────────────────────────────────────────

    print("\n── Model Summary ────────────────────────────────────────────────")
    by_model: dict[str, list[float]] = {}
    for entry in results_log:
        by_model.setdefault(entry["model"], []).append(entry["reward"])
    for model_name, rewards in by_model.items():
        avg = sum(rewards) / len(rewards)
        passed = sum(1 for v in rewards if v >= SUCCESS_REWARD_THRESHOLD)
        print(f"  {model_name:38s}  avg={avg:.2f}  passed={passed}/{len(rewards)}")

    # ── Save ───────────────────────────────────────────────────────────────

    OUT_DIR.mkdir(exist_ok=True)
    payload = {
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "environment": HUB_ENV,
        "task": {
            "url": TASK_URL,
            "prompt": TASK_PROMPT,
            "expected": TASK_EXPECTED,
            "compare_mode": TASK_COMPARE_MODE,
        },
        "models": MODELS,
        "group": GROUP,
        "total_runs": len(results_log),
        "results": results_log,
    }
    OUT_FILE.write_text(json.dumps(payload, indent=2))
    print(f"\n[hud_runner] Saved {len(results_log)} traces → {OUT_FILE}")

    # ── Sanity check ───────────────────────────────────────────────────────

    passed = sum(1 for r in results_log if r["reward"] >= SUCCESS_REWARD_THRESHOLD)
    failed = len(results_log) - passed
    if passed >= 1 and failed >= 1:
        print(f"[hud_runner] ✓ Demo data looks good: {passed} passed, {failed} failed")
    else:
        print(f"[hud_runner] ⚠ All runs {'passed' if failed == 0 else 'failed'} — demo story may be less interesting")


if __name__ == "__main__":
    asyncio.run(main())

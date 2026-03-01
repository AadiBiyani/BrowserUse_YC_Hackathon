"""
Compatibility-mode canary rollout validation.

This script validates a curated canary task set end-to-end through:
  tasks.yaml set -> legacy payload -> API normalization -> runner handoff.

It does not call HUD or external services. Instead, it monkeypatches the
experiment runner entrypoint so we can verify payload flow safely.

Usage:
    cd backend
    uv run python validate_canary_compat.py
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import yaml

import api
import experiment_runner
from api import RunExperimentRequest


TASK_CATALOG = Path(__file__).parent / "tasks.yaml"
CANARY_SET_ID = "canary_compat_v1"
DEFAULT_VARIANTS = [
    {"model": "gpt-4o-mini", "tool_config": "full"},
]


def _load_catalog() -> dict[str, Any]:
    payload = yaml.safe_load(TASK_CATALOG.read_text()) or {}
    if not isinstance(payload, dict):
        raise ValueError("tasks.yaml must contain a top-level object")
    return payload


def _index_tasks(tasks: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for task in tasks:
        task_id = task.get("task_id")
        if isinstance(task_id, str) and task_id:
            indexed[task_id] = task
    return indexed


def _build_legacy_payload(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "url": task["url"],
        "prompt": task["goal"],
        "expected": task.get("expected"),
        "compare_mode": task.get("compare_mode", "contains"),
        # Preserve metadata so the same payload can remain task-aware downstream.
        "task_id": task.get("task_id"),
        "difficulty": task.get("difficulty"),
        "category": task.get("category"),
        "success_conditions": task.get("success_conditions"),
    }


async def _run_validation() -> list[dict[str, Any]]:
    catalog = _load_catalog()
    tasks = catalog.get("tasks") or []
    task_sets = catalog.get("task_sets") or []
    if not isinstance(tasks, list) or not isinstance(task_sets, list):
        raise ValueError("tasks.yaml must define list fields: tasks and task_sets")

    task_by_id = _index_tasks(tasks)
    canary_set = next(
        (
            item
            for item in task_sets
            if isinstance(item, dict) and item.get("set_id") == CANARY_SET_ID
        ),
        None,
    )
    if canary_set is None:
        raise ValueError(f"canary set {CANARY_SET_ID!r} not found in tasks.yaml")

    task_ids = canary_set.get("task_ids") or []
    if not isinstance(task_ids, list) or not task_ids:
        raise ValueError(f"canary set {CANARY_SET_ID!r} has no task_ids")

    captured_calls: list[dict[str, Any]] = []

    async def fake_run_experiment(
        experiment_id: str,
        task_config: dict[str, Any],
        variant_specs: list[dict[str, Any]],
        group: int = 3,
    ) -> None:
        captured_calls.append(
            {
                "experiment_id": experiment_id,
                "task_config": task_config,
                "variant_specs": variant_specs,
                "group": group,
            }
        )

    orig_run_experiment = experiment_runner.run_experiment
    orig_create_task = api.asyncio.create_task
    spawned: list[asyncio.Task[Any]] = []

    def capture_task(coro: Any) -> asyncio.Task[Any]:
        task = asyncio.get_running_loop().create_task(coro)
        spawned.append(task)
        return task

    experiment_runner.run_experiment = fake_run_experiment
    api.asyncio.create_task = capture_task

    try:
        for task_id in task_ids:
            task = task_by_id.get(task_id)
            if task is None:
                raise ValueError(f"task_id {task_id!r} referenced by canary set but missing")

            legacy_payload = _build_legacy_payload(task)
            req = RunExperimentRequest(
                experiment_id=f"canary-compat-validation-{task_id}",
                task=legacy_payload,
                variant_specs=DEFAULT_VARIANTS,
                group=1,
            )
            response = await api.run_experiment_endpoint(req)
            if response.get("status") != "started":
                raise ValueError(f"unexpected API response for {task_id}: {response}")

        if spawned:
            await asyncio.gather(*spawned)

    finally:
        experiment_runner.run_experiment = orig_run_experiment
        api.asyncio.create_task = orig_create_task

    if len(captured_calls) != len(task_ids):
        raise ValueError(
            f"expected {len(task_ids)} captured calls, got {len(captured_calls)}"
        )

    validation_rows: list[dict[str, Any]] = []
    for entry in captured_calls:
        task_config = entry["task_config"]
        scenario_args = task_config.get("scenarioArgs") or {}
        validation_rows.append(
            {
                "experiment_id": entry["experiment_id"],
                "taskId": task_config.get("taskId"),
                "scenario": task_config.get("scenario"),
                "compare_mode": scenario_args.get("compare_mode"),
                "url_present": bool(scenario_args.get("url")),
                "prompt_present": bool(scenario_args.get("prompt")),
                "metadata": {
                    "difficulty": task_config.get("difficulty"),
                    "category": task_config.get("category"),
                },
            }
        )

    return validation_rows


async def main() -> None:
    rows = await _run_validation()
    print("[canary-rollout] Compatibility mode validation passed.")
    print(json.dumps({"set_id": CANARY_SET_ID, "validated": rows}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())

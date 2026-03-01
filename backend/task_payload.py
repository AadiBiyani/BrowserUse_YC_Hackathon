"""
Normalize task payloads for experiment execution.

Supports both:
1) Legacy shape:
   {url, prompt, expected?, compare_mode?}
2) New shape:
   {scenario, scenarioArgs, ...metadata}
"""
from __future__ import annotations

from typing import Any


def _pick(mapping: dict[str, Any], *keys: str) -> Any:
    """Return the first non-None key value from mapping."""
    for key in keys:
        value = mapping.get(key)
        if value is not None:
            return value
    return None


def normalize_task_payload(task: dict[str, Any]) -> dict[str, Any]:
    """
    Return a normalized task payload with a scenario contract.

    Output contract:
      {
        "scenario": str,
        "scenarioArgs": dict[str, Any],
        "taskId"?: str,
        "externalId"?: str,
        "difficulty"?: str,
        "category"?: str,
        "successConditions"?: list[Any],
        "maxSteps"?: int,
        "timeoutSec"?: int,
        "maxAttempts"?: int,
        "retryDelaySec"?: float,
        "retryTransientOnly"?: bool,
      }
    """
    if not isinstance(task, dict):
        raise ValueError("task must be an object")

    scenario = _pick(task, "scenario") or "answer"
    if not isinstance(scenario, str) or not scenario.strip():
        raise ValueError("task.scenario must be a non-empty string")
    scenario = scenario.strip()

    raw_scenario_args = _pick(task, "scenarioArgs", "scenario_args")
    if raw_scenario_args is None:
        scenario_args: dict[str, Any] = {}
    elif isinstance(raw_scenario_args, dict):
        scenario_args = dict(raw_scenario_args)
    else:
        raise ValueError("task.scenarioArgs must be an object when provided")

    # Backward-compatible mapping for the old API shape.
    legacy_args = {
        "url": _pick(task, "url"),
        "prompt": _pick(task, "prompt"),
        "expected": _pick(task, "expected"),
        "compare_mode": _pick(task, "compare_mode", "compareMode"),
    }
    has_legacy_fields = any(value is not None for value in legacy_args.values())

    if scenario == "answer":
        # Merge legacy args first, then let explicit scenarioArgs win.
        merged_args = {k: v for k, v in legacy_args.items() if v is not None}
        merged_args.update(scenario_args)
        scenario_args = merged_args

        # Keep existing behavior for answer scenarios.
        scenario_args.setdefault("compare_mode", "contains")
        if not scenario_args.get("url") or not scenario_args.get("prompt"):
            raise ValueError("answer scenario requires url and prompt")
    elif has_legacy_fields and not raw_scenario_args:
        raise ValueError(
            "legacy task fields (url/prompt/expected/compare_mode) are only valid for scenario='answer'"
        )

    normalized: dict[str, Any] = {
        "scenario": scenario,
        "scenarioArgs": scenario_args,
    }

    optional_mappings = {
        "taskId": ("taskId", "task_id"),
        "externalId": ("externalId", "external_id"),
        "difficulty": ("difficulty",),
        "category": ("category",),
        "successConditions": ("successConditions", "success_conditions"),
        "maxSteps": ("maxSteps", "max_steps"),
        "timeoutSec": ("timeoutSec", "timeout_sec"),
        "maxAttempts": ("maxAttempts", "max_attempts"),
        "retryDelaySec": ("retryDelaySec", "retry_delay_sec"),
        "retryTransientOnly": ("retryTransientOnly", "retry_transient_only"),
    }
    for output_key, input_keys in optional_mappings.items():
        value = _pick(task, *input_keys)
        if value is not None:
            normalized[output_key] = value

    return normalized

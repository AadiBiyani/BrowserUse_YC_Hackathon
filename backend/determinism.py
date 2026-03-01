"""
determinism.py — Compute behavioural determinism scores for experiment runs.

Determinism score (0–1) measures how consistently an agent behaves across
multiple runs of the *same* task with the *same* model.  We extract the
ordered sequence of browser/tool actions from each HUD trace and compute
pairwise SequenceMatcher ratios.  Each run receives the mean similarity to
all other runs in its variant (same model).

A score of 1.0 means the agent took identical actions every time.
A score of 0.0 means no overlap at all.
Runs with no peers (single run) receive null.

Entrypoint:
    await compute_and_store(experiment_id, variant_run_map, convex_url)

Where variant_run_map is:
    {
        "<variantId>": [
            {"run_id": "<convex run _id>", "trace": <full HUD trace dict>},
            ...
        ]
    }
"""
from __future__ import annotations

import logging
from difflib import SequenceMatcher
from typing import Any

import httpx

logger = logging.getLogger(__name__)


# ── Action extraction ──────────────────────────────────────────────────────────

def _extract_action_sequence(trace: dict) -> list[str]:
    """
    Return an ordered list of tool-call names from a HUD trace trajectory.

    Each element is a string like "click", "input", "navigate", "scroll", etc.
    Only `tools/call.mcp` spans are included; prompt/inference spans are skipped
    since those vary by model and don't reflect behavioural consistency.
    """
    trajectory = trace.get("trajectory") or []
    actions: list[str] = []
    for span in trajectory:
        if not isinstance(span, dict):
            continue
        if span.get("name") != "tools/call.mcp":
            continue
        attrs = span.get("attributes") or {}
        req = attrs.get("request") or {}
        if isinstance(req, str):
            import json
            try:
                req = json.loads(req)
            except Exception:
                continue
        # params.name is the tool name: "click", "input", "navigate", etc.
        params = req.get("params") or {}
        tool_name = params.get("name")
        if tool_name:
            actions.append(tool_name)
    return actions


# ── Similarity ─────────────────────────────────────────────────────────────────

def _sequence_similarity(seq_a: list[str], seq_b: list[str]) -> float:
    """Normalised SequenceMatcher ratio between two action sequences."""
    if not seq_a and not seq_b:
        return 1.0
    if not seq_a or not seq_b:
        return 0.0
    return SequenceMatcher(None, seq_a, seq_b).ratio()


def compute_variant_scores(
    run_traces: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Compute determinism scores for a list of runs from the same variant.

    Args:
        run_traces: list of {"run_id": str, "trace": dict}

    Returns:
        list of {"run_id": str, "determinism_score": float | None}
    """
    if len(run_traces) < 2:
        # Cannot compute determinism with a single run
        return [{"run_id": r["run_id"], "determinism_score": None} for r in run_traces]

    sequences = [_extract_action_sequence(r["trace"]) for r in run_traces]

    scores: list[dict[str, Any]] = []
    for i, run in enumerate(run_traces):
        similarities = [
            _sequence_similarity(sequences[i], sequences[j])
            for j in range(len(run_traces))
            if j != i
        ]
        score = sum(similarities) / len(similarities) if similarities else None
        scores.append({"run_id": run["run_id"], "determinism_score": score})
        logger.info(
            "Determinism score for run %s: %.3f (vs %d peers, actions=%d)",
            run["run_id"],
            score if score is not None else -1,
            len(similarities),
            len(sequences[i]),
        )
    return scores


# ── Convex write-back ──────────────────────────────────────────────────────────

async def _push_score_to_convex(
    client: httpx.AsyncClient,
    convex_url: str,
    run_id: str,
    score: float,
) -> None:
    """Call the runs:updateDeterminismScore mutation via Convex HTTP API."""
    r = await client.post(
        f"{convex_url}/api/mutation",
        json={
            "path": "runs:updateDeterminismScore",
            "args": {"id": run_id, "determinismScore": score},
            "format": "json",
        },
        timeout=10,
    )
    if r.status_code != 200:
        logger.warning(
            "Failed to update determinism score for run %s: %d %s",
            run_id, r.status_code, r.text[:200],
        )


# ── Main entrypoint ────────────────────────────────────────────────────────────

async def compute_and_store(
    experiment_id: str,
    variant_run_map: dict[str, list[dict[str, Any]]],
    convex_url: str,
) -> dict[str, Any]:
    """
    Compute determinism scores for all variants in an experiment and write
    them back to Convex.

    Args:
        experiment_id:   Convex experiment _id (for logging).
        variant_run_map: {variantId: [{"run_id": str, "trace": dict}, ...]}
        convex_url:      Base URL of the Convex deployment (e.g. https://xxx.convex.cloud)

    Returns:
        Summary dict with counts.
    """
    total_scored = 0
    total_null = 0

    async with httpx.AsyncClient() as client:
        for variant_id, run_traces in variant_run_map.items():
            logger.info(
                "Computing determinism for variant %s (%d runs)…",
                variant_id, len(run_traces),
            )
            results = compute_variant_scores(run_traces)
            for result in results:
                score = result["determinism_score"]
                if score is not None:
                    await _push_score_to_convex(
                        client, convex_url, result["run_id"], score
                    )
                    total_scored += 1
                else:
                    total_null += 1

    summary = {
        "experiment_id": experiment_id,
        "variants_processed": len(variant_run_map),
        "runs_scored": total_scored,
        "runs_skipped_single": total_null,
    }
    logger.info("Determinism computation complete: %s", summary)
    return summary

"""
fetch_trajectories.py — Fetch full trajectory + screenshot data from HUD telemetry API.

Real endpoint discovered from hud-trace-explorer source:
  GET https://api.hud.ai/telemetry/traces/{trace_id}
  params: include_trajectory=true, include_logs=true

Screenshots stored in Supabase:
  https://gahludmjcsmszgyufydt.supabase.co/storage/v1/object/public/screenshots/{trace_id}/{n}.png

Usage:
    cd backend && uv run python fetch_trajectories.py
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

HUD_API_KEY = os.environ["HUD_API_KEY"]
SUPABASE_SCREENSHOTS = "https://gahludmjcsmszgyufydt.supabase.co/storage/v1/object/public/screenshots"

TRACES = {
    "gpt4o_pass":  "5cd19812-a3dc-4714-a0bc-1db7afa62e61",
    "gpt4o_fail":  "0e240ae9-9716-4826-84cb-b699225c68b2",
    "claude_pass": "bb2daf44-b77e-4294-b296-5179415d4ed0",
}

OUT = Path(__file__).parent / "runs"
OUT.mkdir(exist_ok=True)


async def main() -> None:
    headers = {"Authorization": f"Bearer {HUD_API_KEY}"}

    async with httpx.AsyncClient(timeout=60) as client:
        for label, tid in TRACES.items():
            print(f"\n=== {label} ({tid}) ===")

            url = f"https://api.hud.ai/telemetry/traces/{tid}"
            r = await client.get(url, headers=headers, params={
                "include_trajectory": "true",
                "include_logs": "false",
                "include_rollout_logs": "false",
            })
            print(f"  GET /telemetry/traces → {r.status_code}")

            if r.status_code != 200:
                print(f"  body: {r.text[:300]}")
                continue

            data = r.json()
            out = OUT / f"trajectory_{label}.json"
            out.write_text(json.dumps(data, indent=2))
            print(f"  Saved → {out}  ({out.stat().st_size:,} bytes)")

            # Summarise structure
            traj = data.get("trajectory") or []
            print(f"  Top-level keys: {list(data.keys())}")
            print(f"  trajectory spans: {len(traj)}")

            if traj:
                print(f"  First span keys: {list(traj[0].keys())}")
                for i, span in enumerate(traj[:3]):
                    print(f"  span[{i}]: type={span.get('type')!r} "
                          f"internal_type={span.get('internal_type')!r} "
                          f"name={span.get('name')!r} "
                          f"status={span.get('status_code')!r}")
                    attrs = span.get("attributes", {})
                    if attrs:
                        print(f"    attributes keys: {list(attrs.keys())}")

            # Count span types
            types = {}
            for span in traj:
                t = span.get("type", "?")
                types[t] = types.get(t, 0) + 1
            print(f"  Span types: {types}")

            # Find screenshot-eligible spans
            screenshot_spans = [
                (i, s) for i, s in enumerate(traj)
                if s.get("internal_type") == "mcp-screenshot"
                or s.get("type") in ("hud-step", "mcp-step-image", "step")
            ]
            print(f"  Screenshot-eligible spans: {len(screenshot_spans)}")

            # Try downloading first screenshot
            if screenshot_spans:
                step_idx, _ = screenshot_spans[0]
                img_url = f"{SUPABASE_SCREENSHOTS}/{tid}/0.png"
                ir = await client.get(img_url)
                print(f"  Screenshot [0] ({img_url}) → {ir.status_code}")
                if ir.status_code == 200:
                    img_path = OUT / f"screenshot_{label}_0.png"
                    img_path.write_bytes(ir.content)
                    print(f"  Saved screenshot → {img_path}  ({len(ir.content):,} bytes)")

    print("\n=== All done. Files in runs/ ===")
    for p in sorted(OUT.glob("*.json")):
        print(f"  {p.name:50s}  {p.stat().st_size:>9,} bytes")


if __name__ == "__main__":
    asyncio.run(main())

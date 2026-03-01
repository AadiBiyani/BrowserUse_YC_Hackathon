"""
get_traces.py — Fetch trace data from HUD analytics MCP and save to runs/

The HUD analytics MCP endpoint (https://api.hud.ai/v3/mcp/) uses the
streamable-HTTP MCP transport: requires Accept: application/json, text/event-stream
and returns SSE-encoded responses. Session ID comes back in the mcp-session-id
response header.

Usage:
    cd backend && uv run python get_traces.py
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
MCP_URL = "https://api.hud.ai/v3/mcp/"

TRACE_IDS = {
    "gpt4o_pass":  "5cd19812-a3dc-4714-a0bc-1db7afa62e61",
    "gpt4o_fail":  "0e240ae9-9716-4826-84cb-b699225c68b2",
    "claude_pass": "bb2daf44-b77e-4294-b296-5179415d4ed0",
}
JOB_ID = "1325246e-c8e0-40b3-9d91-08db5978c64d"

OUT_DIR = Path(__file__).parent / "runs"
OUT_DIR.mkdir(exist_ok=True)


def _base_headers(session_id: str | None = None) -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {HUD_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if session_id:
        h["mcp-session-id"] = session_id
    return h


def _parse_sse(raw: str) -> dict | None:
    """Parse the first 'data:' line from an SSE response body."""
    for line in raw.splitlines():
        if line.startswith("data:"):
            try:
                return json.loads(line[5:].strip())
            except json.JSONDecodeError:
                pass
    # Maybe it's plain JSON (some responses aren't SSE-wrapped)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def mcp_request(
    client: httpx.AsyncClient,
    session_id: str | None,
    payload: dict,
    timeout: float = 30.0,
) -> tuple[int, dict | None, str | None]:
    """Make one MCP request, return (status, parsed_body, new_session_id)."""
    r = await client.post(
        MCP_URL,
        headers=_base_headers(session_id),
        json=payload,
        timeout=timeout,
    )
    new_sid = r.headers.get("mcp-session-id") or session_id
    parsed = _parse_sse(r.text) if r.text.strip() else None
    return r.status_code, parsed, new_sid


async def main() -> None:
    async with httpx.AsyncClient() as client:

        # ── 1. Initialize ──────────────────────────────────────────────────
        print("Step 1: initialize")
        status, body, session_id = await mcp_request(client, None, {
            "jsonrpc": "2.0", "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "agentlens-inspector", "version": "0.1"},
            },
        })
        print(f"  status={status}  session_id={session_id!r}")
        if body:
            server_info = body.get("result", {}).get("serverInfo", {})
            print(f"  server: {server_info}")
        if status >= 400:
            print(f"  ERROR: {body}")
            return
        # Some stateless MCP servers omit session_id — proceed anyway using None

        # ── 2. Notify initialized ──────────────────────────────────────────
        print("\nStep 2: notifications/initialized")
        status2, _, session_id = await mcp_request(client, session_id, {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        })
        print(f"  status={status2}")

        # ── 3. List tools ──────────────────────────────────────────────────
        print("\nStep 3: tools/list")
        status3, body3, session_id = await mcp_request(client, session_id, {
            "jsonrpc": "2.0", "id": 1,
            "method": "tools/list", "params": {},
        })
        print(f"  status={status3}")
        if body3:
            tools = body3.get("result", {}).get("tools", [])
            print(f"  {len(tools)} tools available:")
            for t in tools:
                print(f"    - {t['name']}")

        # ── 4. get_job_traces ──────────────────────────────────────────────
        print(f"\nStep 4: get_job_traces (job_id={JOB_ID})")
        status4, body4, session_id = await mcp_request(client, session_id, {
            "jsonrpc": "2.0", "id": 2,
            "method": "tools/call",
            "params": {"name": "get_job_traces", "arguments": {"job_id": JOB_ID}},
        }, timeout=60.0)
        print(f"  status={status4}")
        if body4:
            out = OUT_DIR / "job_traces.json"
            out.write_text(json.dumps(body4, indent=2))
            print(f"  Saved → {out}")
            content = body4.get("result", {}).get("content", [])
            for c in content:
                print(f"  [{c.get('type')}] {str(c.get('text',''))[:200]}")

        # ── 5. get_trace for each trace ID ─────────────────────────────────
        print("\nStep 5: get_trace on 3 traces")
        for i, (label, tid) in enumerate(TRACE_IDS.items()):
            print(f"\n  [{label}] trace_id={tid}")
            status5, body5, session_id = await mcp_request(client, session_id, {
                "jsonrpc": "2.0", "id": 10 + i,
                "method": "tools/call",
                "params": {"name": "get_trace", "arguments": {"trace_id": tid}},
            }, timeout=60.0)
            print(f"  status={status5}")
            if body5:
                out = OUT_DIR / f"trace_{label}.json"
                out.write_text(json.dumps(body5, indent=2))
                print(f"  Saved → {out}")
                content = body5.get("result", {}).get("content", [])
                for c in content:
                    text = str(c.get("text", ""))
                    print(f"  [{c.get('type')}] {text[:300]}")
            else:
                print(f"  No body / error")

    # ── Summary ─────────────────────────────────────────────────────────────
    print("\n=== Files in runs/ ===")
    for p in sorted(OUT_DIR.glob("*.json")):
        print(f"  {p.name:45s}  {p.stat().st_size:>8,} bytes")


if __name__ == "__main__":
    asyncio.run(main())

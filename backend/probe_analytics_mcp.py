"""Probe the HUD analytics MCP endpoint (no environment context) for get_trace tool."""
from __future__ import annotations
import asyncio, json, os
from pathlib import Path
import httpx
from dotenv import load_dotenv

load_dotenv()
HUD_API_KEY = os.environ["HUD_API_KEY"]

ANALYTICS_URLS = [
    "https://api.hud.ai/v3/mcp/",
]

TRACE_ID = "5cd19812-a3dc-4714-a0bc-1db7afa62e61"
JOB_ID   = "1325246e-c8e0-40b3-9d91-08db5978c64d"
OUT_DIR  = Path(__file__).parent / "runs"
OUT_DIR.mkdir(exist_ok=True)


async def try_analytics_mcp(url: str) -> None:
    print(f"\n=== Trying {url} ===")
    # Streamable-HTTP MCP transport requires accepting both JSON and SSE
    base_headers = {
        "Authorization": f"Bearer {HUD_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    async with httpx.AsyncClient() as client:
        # Initialize without environment name
        init_payload = {
            "jsonrpc": "2.0", "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "inspector", "version": "0.1"},
            },
        }
        r = await client.post(url, headers=base_headers, json=init_payload, timeout=20)
        print(f"  initialize → {r.status_code}")
        print(f"  body: {r.text[:500]}")

        if r.status_code >= 400:
            return

        session_id = r.headers.get("mcp-session-id") or r.headers.get("x-session-id")
        try:
            resp_json = r.json()
            session_id = session_id or resp_json.get("result", {}).get("session_id")
        except Exception:
            pass
        print(f"  session_id = {session_id!r}")
        if not session_id:
            return

        hdrs = {**base_headers, "mcp-session-id": session_id}

        # Send initialized notification
        await client.post(url, headers=hdrs, json={"jsonrpc":"2.0","method":"notifications/initialized"}, timeout=10)

        # List tools
        r2 = await client.post(url, headers=hdrs, json={"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}, timeout=20)
        print(f"  tools/list → {r2.status_code}")
        if r2.status_code == 200:
            tools = r2.json().get("result", {}).get("tools", [])
            print(f"  {len(tools)} tools:")
            for t in tools:
                print(f"    - {t['name']}: {t.get('description','')[:70]}")

            # get_trace
            r3 = await client.post(url, headers=hdrs, json={
                "jsonrpc":"2.0","id":2,"method":"tools/call",
                "params":{"name":"get_trace","arguments":{"trace_id": TRACE_ID}}
            }, timeout=30)
            print(f"\n  get_trace → {r3.status_code}")
            slug = url.replace("https://","").replace("/","_")
            if r3.status_code == 200:
                out = OUT_DIR / f"analytics_trace_{slug}.json"
                out.write_text(r3.text)
                print(f"  Saved → {out}")
            else:
                print(f"  body: {r3.text[:400]}")

            # get_job_traces
            r4 = await client.post(url, headers=hdrs, json={
                "jsonrpc":"2.0","id":3,"method":"tools/call",
                "params":{"name":"get_job_traces","arguments":{"job_id": JOB_ID}}
            }, timeout=30)
            print(f"\n  get_job_traces → {r4.status_code}")
            if r4.status_code == 200:
                out = OUT_DIR / f"analytics_job_{slug}.json"
                out.write_text(r4.text)
                print(f"  Saved → {out}")
            else:
                print(f"  body: {r4.text[:400]}")
        else:
            print(f"  body: {r2.text[:300]}")


async def main() -> None:
    for url in ANALYTICS_URLS:
        await try_analytics_mcp(url)

if __name__ == "__main__":
    asyncio.run(main())

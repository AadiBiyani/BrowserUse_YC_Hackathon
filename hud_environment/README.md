# Trace.IQ Browser Environment

A HUD environment that wraps the Browser Use Python SDK into tool calls for Trace.IQ agent benchmarking. Based on [hud-evals/browser-use-hud-environment](https://github.com/hud-evals/browser-use-hud-environment).

Includes two scenarios:

- **`answer`** — browse to a URL, complete a task, optionally compare against an expected answer.
- **`wiki-game`** — navigate Wikipedia from a start page to a target page using only link clicks.

## Deploy

```bash
cd hud_environment
pip install hud-python
hud deploy
```

## Run locally

```bash
pip install -e .
hud dev env:env
```

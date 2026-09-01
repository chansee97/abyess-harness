<div align="center">

<img src="apps/web/public/icon.svg" width="80" alt="abyss-harness" />

# abyss-harness

</div>

<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md)
</div>

**A miniature agent harness built on [Cordis](https://github.com/cordiverse/cordis) — every capability is a plugin.**

<p align="center">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/docs-English-blue"></a>
  <a href="README.zh-CN.md"><img alt="简体中文" src="https://img.shields.io/badge/docs-简体中文-red"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white"></a>
  <a href="https://pnpm.io/"><img alt="pnpm" src="https://img.shields.io/badge/pnpm-workspace-f69220?logo=pnpm&logoColor=white"></a>
  <a href="https://github.com/cordiverse/cordis"><img alt="Cordis" src="https://img.shields.io/badge/powered%20by-Cordis-7c3aed"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

*The same plugin framework underneath [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), organized the same way: the framework layer is **vendored under `vendor/`** (renamed to `@abyss-harness/*`, see [`vendor/README.md`](vendor/README.md)), and every capability is a plugin in a workspace package.*

---

## Table of Contents

- [abyss-harness](#abyss-harness)
  - [Table of Contents](#table-of-contents)
  - [Why this project](#why-this-project)
  - [Features](#features)
  - [Quick Start](#quick-start)
    - [Environment Variables](#environment-variables)
    - [Scripts](#scripts)
  - [Project Structure](#project-structure)
  - [Architecture](#architecture)
  - [How a Request Flows](#how-a-request-flows)
  - [Try These Demos](#try-these-demos)
  - [Notes](#notes)
  - [License](#license)
  - [Acknowledgments](#acknowledgments)

## Why this project

The whole application is the entry list in [`cordis.yml`](cordis.yml); [`packages/bundle/base/cordis.patch.yml`](packages/bundle/base/cordis.patch.yml) carries the identical rows as a bundle patch payload. Reading this repo is a readable, executable tour of:

- how a microkernel plugin framework organizes a real application,
- how services meet through **seams** (service keys + typed events) instead of imports,
- how composition becomes **configuration** — add/remove a line, gain/lose a capability.

## Features

- 🔌 **Microkernel architecture** — Cordis context tree; load order comes from service dependencies (`inject`), not from file position.
- 🧩 **Everything is a plugin** — LLM adapter, tools, approval, persistence, webserver, UI: all are entries in `cordis.yml`.
- 🤖 **OpenAI-compatible LLM** — works with DeepSeek, Moonshot, OpenRouter, vLLM, Ollama, ... via `OPENAI_BASE_URL`.
- 🛠 **Built-in toolset** — `read` / `write` / `edit` / glob+grep search / `bash` / `ask_user_question`.
- 🛡 **Sandbox policy + approval gating** — policy judges first; escalations surface as browser Allow/Deny cards.
- 💾 **The log is the source of truth** — durable JSONL session log; restart and the conversation continues.
- 📊 **Token metering** — per-session token/cost stats streamed to the UI.
- ⚡ **Frontend hot reload** — `vite build --watch` + rebuild signal; the open page refreshes itself.
- 🧠 **Context compaction** — budget-driven; old tool results stubbed, session log never touched.

## Quick Start

> Prerequisites: Node.js ≥ 20, [pnpm](https://pnpm.io/) ≥ 10.

```sh
git clone <your-fork-url> abyss-harness
cd abyss-harness

pnpm install
pnpm run build:web          # build the browser UI once (frontend dist → web-dist/)

cp .env.example .env        # fill in OPENAI_API_KEY / OPENAI_BASE_URL / MODEL_NAME
pnpm run dev                # opens http://127.0.0.1:3080
```

**Frontend development** (no manual build): in a second terminal run `pnpm run dev:web`
— a `vite build --watch` that rebuilds `web-dist/` on every source edit. The backend
stat-polls the dist and broadcasts a reload frame over the event downlink, so the
open page refreshes itself. There is no separate frontend dev-server address: the
page always comes from the backend origin (same as harness).

### Environment Variables

| Variable | Required | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | yes | Any OpenAI-compatible API key |
| `OPENAI_BASE_URL` | yes | Endpoint root — DeepSeek, Moonshot, OpenRouter, vLLM, Ollama, ... |
| `MODEL_NAME` | yes | Model id interpreted by the provider |
| `DEMO_PORT` | no (default `3080`) | Web UI port |

### Scripts

| Script | Meaning |
|---|---|
| `pnpm run dev` | Boot the whole tree with tsx, open the browser |
| `pnpm run dev:web` | Watch-rebuild the frontend into `web-dist/` |
| `pnpm run build:web` | One-shot frontend build |
| `pnpm test` | Run vitest suites |
| `pnpm run typecheck` | Typecheck vendor (relaxed) + product (strict) + web |

## Project Structure

```
vendor/                    framework layer, owned and pinned (@abyss-harness scope)
  cordis/ loader/ include/ hmr/ timer/ group/ logger-console/ cosmokit/ schemastery/
packages/
  core/       session · system-prompt · tools · agent-loop · compaction (context budget)
  llm/        llm (adapter seam) · openai (OpenAI-compatible adapter) · llm-retry
  fs/         tool-read-file · tool-write-file · tool-str-replace-editor · tool-fs-search (glob/grep)
  shell/      tool-bash
  sandbox/    sandbox · sandbox-policy (file-effect policy on ctx.sandboxPolicy)
  policy/     approval-service (seam) · approval-policy · tool-ask-user · tool-result-limiter
  persistence/session-persistence-jsonl
  observe/    tool-observer · token-meter
  host/       webserver · web-api · frontend-static
  client/     connection (browser wire client) · ui-renderer · ui-layout · ui-sidebar
              ui-conversation · ui-tool (toolviews) · ui-primitives · ui-theme
  boot/       app-boot (.env loading, boot sequence, browser handoff)
  bundle/base/cordis.patch.yml — the distribution unit
apps/
  cli/        the bin: boots the tree, opens the browser
  web/        thin Vite shell over the client packages (builds to web-dist/)
```

## Architecture

```
cordis.yml  ──the application──▶  Context tree
                                    │
   ┌────────────────────────────────┼────────────────────────────────┐
   │ services on ctx                │ events between them            │
   ├ ctx.llm        adapter seam    ├ llm/stream        waterfall    │
   ├ ctx.session     append-only log ├ session/event     emit         │
   ├ ctx.systemPrompt sections       ├ tools/pre-execute waterfall    │
   ├ ctx.tools       pipeline       ├ tools/execute      waterfall    │
   ├ ctx.webServer   http carrier   ├ tools/post-execute waterfall    │
   ├ ctx.approval    human gate     ├ approval/request   emit         │
   └ ctx.agentLoop   driver         └ approval/settled   emit         │
```

Turn flow (`@abyss-harness/agent-loop`): one **turn** = zero or more **steps**; a step = one model request + its tool calls. History is re-derived from the session log before every request ("model-visible means logged").

No plugin imports another plugin's implementation — they meet through service keys (`ctx.llm`, `ctx.tools`, ...) declared via `inject`, and typed events. Cross-package imports use the `@abyss-harness/*` names resolved by tsconfig `paths` at type time and pnpm workspace links at runtime.

## How a Request Flows

1. Browser POSTs `/api/send {text}` → `agentLoop.run()` starts in the background.
2. Every durable fact lands in the session log and broadcasts as `session/event`.
3. The API plugin relays events to browsers over a **downlink-only** WebSocket.
4. When the model calls `write`, `edit` or `bash`, the approval policy intercepts `tools/pre-execute`: the sandbox policy judges first (compliant calls auto-allow, policy rejections are denied with a reason), and calls exceeding the policy escalate to the browser Allow/Deny card via `approval/request`. Denial is a waterfall veto.
5. Page load fetches `/api/state` (full log snapshot) then folds live events with the same pure fold.

## Try These Demos

1. **Waterfall veto** — ask the model to write a file; click **Deny**. The denial flows back as a tool result and the loop continues.
2. **Frontend dev loop** — with `pnpm run dev` + `pnpm run dev:web`, edit `packages/client/ui-conversation/src/index.tsx`: the dist rebuilds and the open page reloads itself.
3. **Dependency-driven loading** — comment out the `session` entry in `cordis.yml`: `agent-loop` sits in PENDING forever, silently.
4. **Composition is configuration** — delete the `tool-bash` entry: the model loses shell access without code changes.
5. **The log is the source of truth** — chat, stop, start again: the conversation continues from `.sessions/session.jsonl`.

## Notes

- `--expose-internals` (in the dev script) is required by the `hmr` plugin. Host-plugin HMR is **disabled by default** (like harness's web profile): chokidar's recursive `fs.watch` floods the event loop on this Windows host (~150% core idle, requests stall to ~15s). With it off, editing `packages/*` or `cordis.yml` needs a `pnpm dev` restart; the frontend dev loop is unaffected (it reloads through the rebuild signal). Set `disabled: false` on the `hmr` entry to re-enable it at that cost.
- The demo is build-free on the host: package `main` fields point at TypeScript sources, executed by tsx. The only build step is the frontend (`vite build` → `web-dist/`).
- Vendored sources compile under relaxed strictness flags ([`tsconfig.vendor.json`](tsconfig.vendor.json)); product packages typecheck strictly against them via `paths` ([`tsconfig.json`](tsconfig.json)).
- The approval service lives in its own package so consumers depend on a seam, not on the policy plugin — mounting it inside the consumer would deadlock on self-inject.
- The demo ships **no sandbox enforcement backend** (harness's landlock/bwrap/seatbelt/Windows-ACL providers are not ported), so a confined mode fails closed — every bash call errors with `SANDBOX_UNAVAILABLE`. It runs `danger-full-access` by default; mount a `SandboxProvider` backend plugin to switch to a confined mode.

## License

This project is licensed under the [MIT License](LICENSE).

## Acknowledgments

- [Cordis](https://github.com/cordiverse/cordis) — the plugin microkernel framework.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the architectural blueprint this demo mirrors.
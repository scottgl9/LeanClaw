# Architecture

LeanClaw is a single-process Node.js runtime combining a WebSocket gateway, container execution engine, and plugin system.

## Process Model

```
┌─────────────────────────────────────────────────────┐
│                  LeanClaw Process                    │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │  Gateway     │  │  Scheduler  │  │  IPC       │ │
│  │  (WS+HTTP)   │  │  (cron/hb)  │  │  Watcher   │ │
│  └──────┬───────┘  └──────┬──────┘  └─────┬──────┘ │
│         │                 │               │        │
│  ┌──────┴─────────────────┴───────────────┴──────┐ │
│  │              Message Queue (GroupQueue)         │ │
│  │         Per-group concurrency control           │ │
│  └──────────────────────┬────────────────────────┘ │
│                         │                          │
│  ┌──────────────────────┴────────────────────────┐ │
│  │           Container Runner (Docker)            │ │
│  │    Spawns isolated agents with env injection    │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌───────────┐  ┌──────────┐  ┌─────────────────┐ │
│  │  SQLite   │  │  Plugins │  │  LLM Providers  │ │
│  │  (DB)     │  │  (ext.)  │  │  (Anth/GH/Local)│ │
│  └───────────┘  └──────────┘  └─────────────────┘ │
│                                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │           Node Registry (distributed)          │ │
│  │   Register/invoke/pair nodes + pending work     │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Component Overview

### Gateway (`src/gateway/`)
WebSocket + HTTP server on port 18789. Implements OpenClaw Protocol v3 with:
- Challenge/connect handshake
- Method routing (request/response)
- Event broadcasting (push to all clients)
- Health endpoints (/health, /ready, /metrics)

### Container Runner (`src/agent/container.ts`)
Spawns Docker containers for agent execution:
- Volume mounts with security validation
- `.env` shadowing (agents can't read host secrets)
- Per-group session isolation
- Streaming output with sentinel markers
- Provider credentials injected via env vars

### Message Queue (`src/queue/group-queue.ts`)
Per-group message queue with concurrency control:
- Max concurrent containers (configurable)
- Task prioritization over messages
- Retry with exponential backoff
- Idle container preemption
- Graceful shutdown (detach, don't kill)

### Scheduler (`src/agent/scheduler.ts`)
Cron/interval/once task scheduling:
- Drift-resistant interval anchoring
- Heartbeat loop with collision avoidance
- Pre-run hook validation

### Plugin System (`src/plugins/`)
Discovers and loads external plugins:
- OpenClaw-compatible `openclaw.plugin.json` manifests
- LRU registry caching
- Dynamic ESM import for plugin modules

### Providers (`src/providers/`)
Multi-LLM support:
- Anthropic Claude (API key + OAuth)
- GitHub Copilot (token + OAuth)
- Local LLM via OpenAI-compatible API (`src/providers/openai-compat.ts`) — works with vLLM, SGLang, llama.cpp, Ollama
- Token budget management (daily/monthly)

### Node Registry (`src/nodes/`)
Distributed node management:
- `NodeRegistry` — register/unregister/list/get/rename/invoke/sendEvent + pairing flow
- `PendingWorkQueue` — enqueue/drain/pull/ack with TTL expiry (max 64 items per node)
- Node role clients auto-register on gateway connect
- Gateway broadcasts `node.connected`/`node.disconnected` events to all clients

## Data Flow

### Inbound Message
```
Channel → Store in SQLite → Message Loop polls →
  → GroupQueue.enqueueMessageCheck() →
    → processGroupMessages() →
      → Format messages (XML) →
        → Run container agent →
          → Stream output → Route to channel
```

### Scheduled Task
```
Scheduler polls SQLite for due tasks →
  → GroupQueue.enqueueTask() →
    → executeScheduledTask() →
      → Run container agent →
        → Log result → Compute next run
```

### IPC (Agent → Host)
```
Agent writes JSON to /workspace/ipc/{messages,tasks}/ →
  → IPC Watcher polls directory →
    → Process command (send message, create task, register group)
```

## Database Schema

SQLite (`better-sqlite3`) with tables:
- `chats` — Chat metadata (JID, name, channel, last activity)
- `messages` — Message content and metadata
- `scheduled_tasks` — Cron/interval/once tasks
- `task_run_logs` — Task execution history
- `router_state` — Key-value state (timestamps, cursors)
- `sessions` — Per-group session IDs
- `registered_groups` — Group registrations with config
- `audit_log` — Security event audit trail
- `provider_usage` — Token usage tracking per group/provider
- `agents` — Agent definitions (CRUD via gateway methods)

## Testing

LeanClaw has **621 tests** across two suites:

### Unit Tests (`src/`) — 492 tests
Cover all internal components:
- `gateway/protocol.test.ts` — Protocol v3 schema, frame types, ConnectParams, HelloOkPayload
- `gateway/auth.test.ts` — API key enforcement, rate limiting, RBAC
- `gateway/health.test.ts` — HTTP endpoint unit tests
- `gateway/openclaw-compat.test.ts` — Full Protocol v3 handshake compatibility
- `gateway/methods.test.ts` — All gateway method responses
- `plugins/loader.test.ts` — Plugin discovery, manifest compat, caching
- `plugins/openclaw-compat.test.ts` — Plugin SDK, PluginRegistry API
- `security/` — Mount security, sender allowlist, audit logging
- `queue/` — GroupQueue concurrency, CollisionTracker
- `agent/` — Session management, container scheduling

### E2E Tests (`e2e/`) — 129 tests across 13 scenarios
Black-box protocol compatibility tests against running LeanClaw gateway:
- Scenarios 1-3: Handshake, frames, method surface
- Scenarios 4-6: Plugins, multi-client, restart recovery
- Scenarios 7-9: Error handling, auth, HTTP endpoints
- Scenarios 10-12: Chat, cron, node role
- Scenario C: Chaos/failure injection

```bash
npm test              # Full suite
npm run e2e           # E2E only
npm run e2e:scorecard # OpenClaw compatibility scorecard
```

**Compatibility scorecard**: P0 25/25 · P1 22/22 · P2 62/62 · Known gaps: 0

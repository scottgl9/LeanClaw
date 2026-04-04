# LeanClaw

High-efficiency, security-first AI assistant runtime. Combines NanoClaw's container isolation with OpenClaw's gateway compatibility and plugin architecture. ~5,500 LOC TypeScript core.

## Architecture

Single Node.js process with in-process WebSocket gateway. Docker container isolation for agent execution. SQLite persistence (`better-sqlite3`). External plugins only (no bundled plugins). Zod for validation. Pino for structured logging. Layered configuration (env vars > .env file > config.json > defaults).

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point (direct-run guard + re-exports) |
| `src/runtime.ts` | Core lifecycle: startup, message loop, task execution, shutdown |
| `src/config.ts` | Layered config (env vars, .env, config.json), group folder validation |
| `src/db.ts` | SQLite schema, migrations, all CRUD operations |
| `src/types.ts` | Shared type definitions for all modules |
| `src/logger.ts` | Pino logger with JSON mode for enterprise |
| `src/gateway/server.ts` | OpenClaw Protocol v3 WebSocket + HTTP server |
| `src/gateway/protocol.ts` | Protocol types, zod schemas, frame helpers |
| `src/gateway/auth.ts` | API key auth, rate limiting (IP/sender/group), RBAC |
| `src/gateway/health.ts` | `/health`, `/ready`, `/metrics` HTTP endpoints |
| `src/plugins/loader.ts` | Plugin discovery (`openclaw.plugin.json`), LRU cache |
| `src/plugins/registry.ts` | Plugin registry (register, get, list, unload, HTTP routes) |
| `src/plugins/plugin-api.ts` | Plugin SDK with registerChannel/Provider/Hook/HttpRoute |
| `src/plugins/sdk.ts` | Plugin SDK re-exports for external authors |
| `src/providers/base.ts` | LLM provider interface and registry |
| `src/providers/anthropic.ts` | Anthropic Claude (API key + OAuth + summarize) |
| `src/providers/copilot.ts` | GitHub Copilot (token + OAuth) |
| `src/providers/token-counter.ts` | Token budget management (daily/monthly) |
| `src/providers/openai-compat.ts` | OpenAI-compatible local LLM provider (vLLM, SGLang, llama.cpp, Ollama) |
| `src/agent/container.ts` | Docker container runner, volume mounts, resource limits |
| `src/agent/session.ts` | Per-group session management with history read/write |
| `src/agent/scheduler.ts` | Cron/interval/once scheduler + heartbeat loop |
| `src/agent/compaction.ts` | Session compaction via LLM summarization |
| `src/agent/exec-approval.ts` | Exec approval manager (request/resolve/timeout) |
| `src/security/mount-security.ts` | Mount allowlist validation with blocked patterns |
| `src/security/sender-allowlist.ts` | Per-chat sender access control |
| `src/security/audit.ts` | Structured audit logging to SQLite |
| `src/channels/interface.ts` | Channel abstraction (ChannelFactory, ChannelOpts) |
| `src/channels/registry.ts` | Self-registering channel registry |
| `src/queue/group-queue.ts` | Per-group message queue with concurrency limits |
| `src/queue/collision.ts` | Heartbeat-cron collision avoidance |
| `src/hooks/pre-run.ts` | Pre-run script hooks (exit 0/10/other) |
| `src/hooks/registry.ts` | Plugin hook event registry (lifecycle hooks) |
| `src/hooks/webhook.ts` | Webhook hook executor (HTTP POST to URLs) |
| `src/nodes/types.ts` | Node type definitions (NodeInfo, PendingWork) |
| `src/nodes/registry.ts` | Node registry (register/unregister/list/get/rename/invoke/sendEvent + pairing) |
| `src/nodes/pending.ts` | Pending work queue (enqueue/drain/pull/ack with TTL, max 64 per node) |
| `src/skills/manager.ts` | Skill discovery, listing, install, update |
| `src/skills/types.ts` | Skill manifest and entry types |
| `src/router.ts` | Message formatting (XML) and outbound routing |
| `src/ipc.ts` | IPC watcher for agent-to-host communication |
| `src/cli.ts` | CLI entry point (start/config/doctor/health/version/help) |

## Security Model

- Agent execution in Docker containers with isolated filesystems
- Mount allowlist at `~/.config/leanclaw/mount-allowlist.json` (never mounted into containers)
- Sender allowlist at `~/.config/leanclaw/sender-allowlist.json`
- `.env` shadowed with `/dev/null` in containers — agents cannot read host secrets
- Credentials injected via env vars at container spawn time (never written to disk)
- Blocked credential patterns: `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.docker`, `credentials`, `private_key`, `.env`, `.netrc`
- Per-group session isolation (separate `.claude/` directories)
- Non-main groups can be forced read-only via `nonMainReadOnly` allowlist setting
- Exec approval flow for tool execution gating (broadcast request → operator approve/reject)
- Container resource limits (memory + CPU) configurable via env vars

## Configuration

### Layered Config (highest priority wins)
1. Environment variables (`LEANCLAW_*`)
2. `.env` file in project root
3. Config file at `~/.config/leanclaw/config.json`
4. Built-in defaults

### Config File Format (`~/.config/leanclaw/config.json`)
```json
{
  "assistant": { "name": "Andy" },
  "gateway": { "port": 18789, "host": "127.0.0.1", "apiKey": "..." },
  "container": { "image": "leanclaw-agent:latest", "timeout": 1800000, "maxConcurrent": 5, "memoryLimit": "2g", "cpuLimit": "2.0" },
  "provider": { "default": "anthropic", "anthropicApiKey": "..." },
  "heartbeat": { "interval": 60000, "skipWhenBusy": true },
  "compaction": { "model": "claude-haiku-4-5", "autoCompact": true },
  "approval": { "timeout": 60000 },
  "localProvider": { "baseUrl": "http://localhost:8000/v1", "apiKey": "...", "model": "my-model" },
  "skills": { "dir": "/path/to/skills" },
  "hooks": { "enabled": true }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LEANCLAW_ASSISTANT_NAME` | `Andy` | Trigger pattern name |
| `LEANCLAW_GATEWAY_PORT` | `18789` | WebSocket/HTTP port |
| `LEANCLAW_GATEWAY_HOST` | `127.0.0.1` | Bind address |
| `LEANCLAW_GATEWAY_API_KEY` | _(none)_ | Auth token |
| `LEANCLAW_ANTHROPIC_API_KEY` | _(none)_ | Claude API key |
| `LEANCLAW_GITHUB_TOKEN` | _(none)_ | GitHub Copilot token |
| `LEANCLAW_DEFAULT_PROVIDER` | `anthropic` | Default LLM provider |
| `LEANCLAW_CONTAINER_IMAGE` | `leanclaw-agent:latest` | Docker image |
| `LEANCLAW_CONTAINER_TIMEOUT` | `1800000` | Hard timeout (ms) |
| `LEANCLAW_MAX_CONCURRENT_CONTAINERS` | `5` | Concurrency limit |
| `LEANCLAW_CONTAINER_MEMORY_LIMIT` | _(none)_ | Docker `--memory` flag (e.g., `2g`) |
| `LEANCLAW_CONTAINER_CPU_LIMIT` | _(none)_ | Docker `--cpus` flag (e.g., `2.0`) |
| `LEANCLAW_IDLE_TIMEOUT` | `1800000` | Idle timeout (ms) |
| `LEANCLAW_HEARTBEAT_INTERVAL` | `60000` | Heartbeat period (ms) |
| `LEANCLAW_COMPACTION_MODEL` | _(auto)_ | Model for session compaction |
| `LEANCLAW_AUTO_COMPACT` | `true` | Auto-compact on context overflow |
| `LEANCLAW_APPROVAL_TIMEOUT` | `60000` | Exec approval timeout (ms) |
| `LEANCLAW_SKILLS_DIR` | _(none)_ | Extra skills directory |
| `LEANCLAW_HOOKS_ENABLED` | `true` | Enable lifecycle hooks |
| `LEANCLAW_LOCAL_LLM_BASE_URL` | _(none)_ | Base URL for OpenAI-compatible local LLM server |
| `LEANCLAW_LOCAL_LLM_API_KEY` | _(none)_ | API key for local LLM server (if required) |
| `LEANCLAW_LOCAL_LLM_MODEL` | _(auto-discover)_ | Model name for local LLM (auto-discovers from `/v1/models` if unset) |

## Conventions

- All config via `LEANCLAW_*` env vars or config.json (precedence: env > .env file > config.json > defaults)
- Tests colocated with source (`*.test.ts` next to `*.ts`)
- No bundled plugins — all extensibility is external
- Docker only (no Podman, no Apple Container)
- ESM modules (`"type": "module"` in package.json)

## Development

```bash
npm run dev          # Run with hot reload (tsx)
npm run build        # Compile TypeScript
npm test             # Run tests (621+ tests)
npm run test:watch   # Watch mode
npm run typecheck    # Type check without emitting
npm run lint         # ESLint
npm run format       # Prettier
```

## CLI Commands

```bash
leanclaw start          # Start the runtime
leanclaw config         # Show current configuration
leanclaw doctor         # Run diagnostic checks (Docker, providers, port, config)
leanclaw health         # Query running gateway health
leanclaw gateway-status # Show gateway status and metrics
leanclaw plugins-list   # List loaded plugins
leanclaw skills-list    # List installed skills
leanclaw version        # Show version
leanclaw help           # Show help
```

## Gateway Protocol

OpenClaw Protocol v3 on `ws://127.0.0.1:18789`. Connect handshake: server sends `connect.challenge`, client responds with `connect` request, server replies with `hello-ok`. All frames are JSON with `type` discriminator (`req`/`res`/`event`).

### Key Gateway Methods
- `agent` — Execute agent in container with streaming events
- `agent.wait` — Wait for agent run completion (timeout support)
- `chat.send` / `chat.abort` — Send/abort messages
- `sessions.list` / `sessions.compact` / `sessions.abort` / `sessions.preview` / `sessions.usage` — Session management
- `sessions.subscribe` / `sessions.unsubscribe` / `sessions.messages.subscribe` / `sessions.messages.unsubscribe` — Session subscriptions
- `exec.approval.resolve` / `exec.approval.request` / `exec.approval.waitDecision` / `exec.approvals.get` / `exec.approvals.set` — Tool execution approval flow
- `tools.catalog` / `tools.effective` / `tools.invoke` — Tool discovery and execution
- `skills.bins` / `skills.status` / `skills.search` / `skills.install` / `skills.update` — Skill management
- `config.get` / `config.set` / `config.patch` / `providers.list` / `groups.list` / `channels.status` — Configuration queries and mutation
- `cron.list` / `cron.add` / `cron.remove` / `cron.run` / `cron.update` / `cron.runs` — Task scheduling
- `agents.create` / `agents.update` / `agents.delete` / `agents.list` — Agent CRUD
- `node.list` / `node.describe` / `node.rename` / `node.invoke` / `node.invoke.result` / `node.event` — Node registry
- `node.pair.request` / `node.pair.list` / `node.pair.approve` / `node.pair.reject` / `node.pair.verify` — Node pairing
- `node.pending.enqueue` / `node.pending.drain` / `node.pending.pull` / `node.pending.ack` — Node pending work
- `logs.tail` — Audit log entries
- `system-presence` / `system-event` — Presence and system events

### HTTP Endpoints
- `GET /health` / `GET /healthz` — Liveness probe
- `GET /ready` / `GET /readyz` — Readiness probe
- `GET /metrics` — JSON health metrics
- `POST /tools/invoke` — HTTP-based tool execution (auth required)
- Plugin-registered custom routes (auth required)

### Plugin SDK

Plugins register capabilities via `register(api)`:
```typescript
export function register(api) {
  api.registerTool({ name, description, parameters, execute });
  api.registerChannel({ name, factory });
  api.registerProvider(provider);
  api.registerHook('before_agent_run', handler);
  api.registerHttpRoute({ method: 'GET', path: '/my-route', handler });
}
```

### Hook Events
- `before_agent_run` / `after_agent_run` — Agent execution lifecycle
- `before_message` / `after_message` — Message processing lifecycle
- `before_compaction` / `after_compaction` — Session compaction lifecycle
- `on_gateway_startup` / `on_gateway_shutdown` — Gateway lifecycle
- `session_start` / `session_end` — Session lifecycle
- `pre_tool_use` / `post_tool_use` — Tool execution lifecycle

### Skills

Skills are directories with a `skill.json` manifest installed at `~/.config/leanclaw/skills/`:
```json
{
  "name": "my-skill",
  "version": "1.0.0",
  "description": "A custom skill",
  "commands": ["my-command"],
  "userInvocable": true
}
```

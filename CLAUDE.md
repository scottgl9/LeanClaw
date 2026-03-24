# LeanClaw

High-efficiency, security-first AI assistant runtime. Combines NanoClaw's container isolation with OpenClaw's gateway compatibility and plugin architecture. ~4,200 LOC TypeScript core.

## Architecture

Single Node.js process with in-process WebSocket gateway. Docker container isolation for agent execution. SQLite persistence (`better-sqlite3`). External plugins only (no bundled plugins). Zod for validation. Pino for structured logging.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point (direct-run guard + re-exports) |
| `src/runtime.ts` | Core lifecycle: startup, message loop, task execution, shutdown |
| `src/config.ts` | Configuration with `LEANCLAW_*` env var overrides, group folder validation |
| `src/db.ts` | SQLite schema, migrations, all CRUD operations |
| `src/types.ts` | Shared type definitions for all modules |
| `src/logger.ts` | Pino logger with JSON mode for enterprise |
| `src/gateway/server.ts` | OpenClaw Protocol v3 WebSocket + HTTP server |
| `src/gateway/protocol.ts` | Protocol types, zod schemas, frame helpers |
| `src/gateway/auth.ts` | API key auth, rate limiting (IP/sender/group), RBAC |
| `src/gateway/health.ts` | `/health`, `/ready`, `/metrics` HTTP endpoints |
| `src/plugins/loader.ts` | Plugin discovery (`openclaw.plugin.json`), LRU cache |
| `src/plugins/registry.ts` | Plugin registry (register, get, list, unload) |
| `src/plugins/sdk.ts` | Plugin SDK re-exports for external authors |
| `src/providers/base.ts` | LLM provider interface and registry |
| `src/providers/anthropic.ts` | Anthropic Claude (API key + OAuth) |
| `src/providers/copilot.ts` | GitHub Copilot (token + OAuth) |
| `src/providers/token-counter.ts` | Token budget management (daily/monthly) |
| `src/agent/container.ts` | Docker container runner, volume mounts, .env shadowing |
| `src/agent/session.ts` | Per-group session management |
| `src/agent/scheduler.ts` | Cron/interval/once scheduler + heartbeat loop |
| `src/security/mount-security.ts` | Mount allowlist validation with blocked patterns |
| `src/security/sender-allowlist.ts` | Per-chat sender access control |
| `src/security/audit.ts` | Structured audit logging to SQLite |
| `src/channels/interface.ts` | Channel abstraction (ChannelFactory, ChannelOpts) |
| `src/channels/registry.ts` | Self-registering channel registry |
| `src/queue/group-queue.ts` | Per-group message queue with concurrency limits |
| `src/queue/collision.ts` | Heartbeat-cron collision avoidance |
| `src/hooks/pre-run.ts` | Pre-run script hooks (exit 0/10/other) |
| `src/router.ts` | Message formatting (XML) and outbound routing |
| `src/ipc.ts` | IPC watcher for agent-to-host communication |
| `src/cli.ts` | CLI entry point (start/config/version/help) |

## Security Model

- Agent execution in Docker containers with isolated filesystems
- Mount allowlist at `~/.config/leanclaw/mount-allowlist.json` (never mounted into containers)
- Sender allowlist at `~/.config/leanclaw/sender-allowlist.json`
- `.env` shadowed with `/dev/null` in containers — agents cannot read host secrets
- Credentials injected via env vars at container spawn time (never written to disk)
- Blocked credential patterns: `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.docker`, `credentials`, `private_key`, `.env`, `.netrc`
- Per-group session isolation (separate `.claude/` directories)
- Non-main groups can be forced read-only via `nonMainReadOnly` allowlist setting

## Conventions

- All config via `LEANCLAW_*` env vars (precedence: env > .env file > defaults)
- Tests colocated with source (`*.test.ts` next to `*.ts`)
- No bundled plugins — all extensibility is external
- Docker only (no Podman, no Apple Container)
- ESM modules (`"type": "module"` in package.json)

## Development

```bash
npm run dev          # Run with hot reload (tsx)
npm run build        # Compile TypeScript
npm test             # Run tests (186 tests)
npm run test:watch   # Watch mode
npm run typecheck    # Type check without emitting
npm run lint         # ESLint
npm run format       # Prettier
```

## Gateway Protocol

OpenClaw Protocol v3 on `ws://127.0.0.1:18789`. Connect handshake: server sends `connect.challenge`, client responds with `connect` request, server replies with `hello-ok`. All frames are JSON with `type` discriminator (`req`/`res`/`event`).

Plugins register custom methods via `server.registerMethod(name, handler)`.

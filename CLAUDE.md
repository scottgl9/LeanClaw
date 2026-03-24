# LeanClaw

High-efficiency, security-first AI assistant runtime. Combines NanoClaw's container isolation with OpenClaw's gateway compatibility and plugin architecture.

## Architecture

Single Node.js process with in-process WebSocket gateway. Docker container isolation for agent execution. SQLite persistence. External plugins only (no bundled plugins).

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point |
| `src/runtime.ts` | Core lifecycle: startup, message loop, shutdown |
| `src/config.ts` | Configuration with env var overrides |
| `src/db.ts` | SQLite operations |
| `src/types.ts` | Shared type definitions |
| `src/gateway/server.ts` | OpenClaw-compatible WebSocket + HTTP server |
| `src/gateway/protocol.ts` | Gateway protocol types and validation |
| `src/gateway/auth.ts` | API key, OAuth, rate limiting |
| `src/gateway/health.ts` | Health/readiness/metrics endpoints |
| `src/plugins/loader.ts` | Plugin discovery and loading (jiti) |
| `src/plugins/registry.ts` | Plugin registry |
| `src/providers/base.ts` | LLM provider interface |
| `src/providers/anthropic.ts` | Anthropic Claude provider |
| `src/providers/copilot.ts` | GitHub Copilot provider |
| `src/providers/token-counter.ts` | Token budget management |
| `src/agent/container.ts` | Docker container runner |
| `src/agent/session.ts` | Session management |
| `src/agent/scheduler.ts` | Cron + heartbeat scheduler |
| `src/security/mount-security.ts` | Mount allowlist validation |
| `src/security/sender-allowlist.ts` | Sender access control |
| `src/security/audit.ts` | Audit logging |
| `src/channels/interface.ts` | Channel abstraction types |
| `src/channels/registry.ts` | Channel registry |
| `src/queue/group-queue.ts` | Per-group message queue |
| `src/queue/collision.ts` | Heartbeat-cron collision avoidance |
| `src/hooks/pre-run.ts` | Pre-run script hooks |

## Security Model

- Agent execution in Docker containers with isolated filesystems
- Mount allowlist at `~/.config/leanclaw/mount-allowlist.json` (never mounted into containers)
- Sender allowlist for access control
- `.env` shadowed with `/dev/null` in containers
- Credentials injected via gateway env vars at container spawn (never on disk)
- Blocked credential patterns: .ssh, .gnupg, .aws, .azure, .kube, .docker

## Development

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
npm test             # Run tests
npm run typecheck    # Type check without emitting
```

## Gateway

OpenClaw-compatible WebSocket gateway on `ws://127.0.0.1:18789`. Supports the OpenClaw plugin SDK format (`openclaw.plugin.json`). Plugins are external — not bundled.

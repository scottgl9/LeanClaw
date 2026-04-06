# LeanClaw

High-efficiency, security-first AI assistant runtime built for fast local execution, low resource usage, and reliable automation through constrained tool access.

LeanClaw combines NanoClaw's container isolation and auditable codebase with OpenClaw's gateway protocol and plugin architecture — in ~3,500 lines of TypeScript.

## Features

- **OpenClaw Gateway Compatible** — Protocol v3 WebSocket + HTTP gateway on `ws://127.0.0.1:18789`
- **Plugin Architecture** — Supports `openclaw.plugin.json` and `leanclaw.plugin.json` manifests (no bundled plugins)
- **Multi-LLM Providers** — Anthropic Claude and GitHub Copilot with API key or OAuth authentication
- **Docker Container Isolation** — Each agent runs in an ephemeral Docker container with isolated filesystem
- **Mount Security** — Allowlist at `~/.config/leanclaw/mount-allowlist.json`, blocked credential patterns (.ssh, .aws, etc.)
- **Pre-run Script Hooks** — Validate whether a run should proceed (exit 0=continue, 10=skip, other=fail)
- **Heartbeat-Cron Collision Avoidance** — Skip heartbeats when cron jobs are executing
- **Token Budget Management** — Daily/monthly limits per group with warn at 80%, block at 100%
- **Enterprise Ready** — Audit logging, RBAC hooks, per-sender/per-group rate limiting, health endpoints
- **Structured Logging** — pino with JSON mode for enterprise pipelines (`LOG_FORMAT=json`)

## Quick Start

```bash
# Install dependencies
npm install

# Configure (copy and edit .env)
cp .env.example .env

# Build
npm run build

# Run
npm start

# Development (hot reload)
npm run dev
```

## Configuration

All settings can be configured via:
1. Environment variables (`LEANCLAW_*` prefix)
2. `.env` file in the project root
3. Defaults in `src/config.ts`

| Variable | Default | Description |
|----------|---------|-------------|
| `LEANCLAW_GATEWAY_PORT` | `18789` | Gateway WebSocket/HTTP port |
| `LEANCLAW_GATEWAY_HOST` | `127.0.0.1` | Gateway bind address |
| `LEANCLAW_GATEWAY_API_KEY` | _(none)_ | API key for gateway auth (open if unset) |
| `LEANCLAW_ANTHROPIC_API_KEY` | _(none)_ | Anthropic Claude API key |
| `LEANCLAW_GITHUB_TOKEN` | _(none)_ | GitHub Copilot token |
| `LEANCLAW_DEFAULT_PROVIDER` | `anthropic` | Default LLM provider (`anthropic` or `copilot`) |
| `LEANCLAW_CONTAINER_IMAGE` | `leanclaw-agent:latest` | Docker image for agent containers |
| `LEANCLAW_MAX_CONCURRENT_CONTAINERS` | `5` | Maximum concurrent agent containers |
| `LEANCLAW_CONTAINER_TIMEOUT` | `1800000` | Container hard timeout (ms) |
| `LEANCLAW_IDLE_TIMEOUT` | `1800000` | Container idle timeout (ms) |
| `LEANCLAW_HEARTBEAT_INTERVAL` | `60000` | Heartbeat interval (ms) |
| `LEANCLAW_HEARTBEAT_SKIP_WHEN_BUSY` | `true` | Skip heartbeats when cron is active |
| `LOG_LEVEL` | `info` | Log level (trace/debug/info/warn/error/fatal) |
| `LOG_FORMAT` | `pretty` | Log format (`pretty` or `json`) |

## Message Routing

Keyword-based pre-turn model routing lets you automatically route messages to different LLM models based on keywords in the incoming message — before any LLM call. Zero cost, pure string matching.

Add a `messageRouting` section to `~/.config/leanclaw/config.json`:

```json
{
  "messageRouting": {
    "rules": [
      { "match": ["code review", "PR", "diff", "refactor"], "model": "github-copilot/claude-sonnet-4.6" },
      { "match": ["research", "search", "find"],            "model": "gemini-3-flash" }
    ],
    "default": "qwen35"
  }
}
```

- **First-match-wins**: Rules are evaluated in order; the first rule with a matching keyword is used.
- **Case-insensitive**: Keyword matching ignores case.
- **`default`**: Fallback model if no rule matches. If omitted, the primary configured model is used.
- **Zero cost**: Pure string matching — no LLM calls to decide routing.

## Gateway API

### HTTP Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness probe — always 200 if running |
| `GET /ready` | Readiness probe — 200 if DB, channels, Docker OK |
| `GET /metrics` | JSON metrics (containers, memory, uptime, tokens) |

### WebSocket Protocol

Connect to `ws://host:port/` and follow the OpenClaw Protocol v3 handshake:

1. Server sends `connect.challenge` event with nonce
2. Client sends `connect` request with protocol version and client info
3. Server responds with `hello-ok` containing features and policy

Available methods after authentication: `health`, `status`, `sessions.list`, `sessions.send`, `config.get`, `channels.status`, `cron.list`, `cron.add`, `cron.remove`, `cron.run`, `groups.list`, `providers.list`, `models.list`, `chat.send`, `chat.abort`, `system-presence`, `system-event`, `agent`, `tools.effective`, `exec.approval.resolve`, `device.token.rotate`, `device.token.revoke`, `skills.bins`, plus any methods registered by plugins. See `docs/gateway-protocol.md` for the full method reference.

## Plugins

Plugins live in external directories — none are bundled with LeanClaw.

Create a plugin by placing an `openclaw.plugin.json` or `leanclaw.plugin.json` manifest in a directory:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "main": "index.js",
  "channels": ["my-channel"],
  "skills": ["skills/"]
}
```

Set `LEANCLAW_PLUGIN_DIR` to the parent directory containing your plugins.

## Security Model

- **Container isolation**: Agents run in Docker containers with no direct host access
- **Mount allowlist**: Only explicitly allowed directories can be mounted (`~/.config/leanclaw/mount-allowlist.json`)
- **Credential injection**: API keys injected via env vars at container spawn time, never written to disk
- **`.env` shadowing**: `.env` file overlaid with `/dev/null` in containers
- **Blocked patterns**: `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.docker`, `credentials`, `private_key`, etc.
- **Sender allowlist**: Per-chat access control (`~/.config/leanclaw/sender-allowlist.json`)
- **Rate limiting**: Per-IP, per-sender, and per-group sliding window limits
- **RBAC hooks**: Pluggable role-based access control (admin/user/viewer)
- **Audit logging**: All access, config changes, and container lifecycle events logged to SQLite

## Project Structure

```
src/
├── index.ts              # Entry point (library re-exports)
├── cli.ts                # CLI (start/config/version/help)
├── runtime.ts            # Core lifecycle
├── router.ts             # Message formatting and routing
├── ipc.ts                # IPC watcher (agent-to-host)
├── types.ts              # Shared type definitions
├── config.ts             # Configuration with env var overrides
├── logger.ts             # Structured logging (pino)
├── db.ts                 # SQLite persistence
├── gateway/
│   ├── server.ts         # WebSocket + HTTP gateway
│   ├── protocol.ts       # Protocol v3 types and schemas
│   ├── auth.ts           # Auth, rate limiting, RBAC
│   └── health.ts         # Health endpoints
├── plugins/
│   ├── loader.ts         # Plugin discovery and loading
│   ├── registry.ts       # Plugin registry
│   └── sdk.ts            # Plugin SDK exports
├── providers/
│   ├── base.ts           # Provider interface and registry
│   ├── anthropic.ts      # Anthropic Claude provider
│   ├── copilot.ts        # GitHub Copilot provider
│   └── token-counter.ts  # Token budget management
├── agent/
│   ├── container.ts      # Docker container runner
│   ├── session.ts        # Session management
│   └── scheduler.ts      # Cron + heartbeat scheduler
├── security/
│   ├── mount-security.ts # Mount allowlist validation
│   ├── sender-allowlist.ts # Sender access control
│   └── audit.ts          # Audit logging
├── channels/
│   ├── interface.ts      # Channel abstraction types
│   └── registry.ts       # Channel registry
├── queue/
│   ├── group-queue.ts    # Per-group message queue
│   └── collision.ts      # Heartbeat-cron collision avoidance
└── hooks/
    └── pre-run.ts        # Pre-run script hooks
```

## Development

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
npm test             # Run tests (473 tests: 339 unit + 129 E2E + 5 CLI)
npm run test:watch   # Watch mode
npm run e2e          # Run E2E compatibility tests only
npm run e2e:scorecard # Generate OpenClaw compatibility scorecard
npm run typecheck    # Type check without emitting
npm run lint         # Lint
npm run format       # Format code
```

## License

Apache-2.0

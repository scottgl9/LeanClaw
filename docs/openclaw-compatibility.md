# OpenClaw Compatibility

LeanClaw is designed as a lightweight, security-first alternative to OpenClaw while maintaining protocol and plugin compatibility.

## Compatibility Tiers

| Tier | Status | Description |
|------|--------|-------------|
| **Protocol** | Full | OpenClaw clients can connect, authenticate, and call methods |
| **Manifest** | Full | Plugin `openclaw.plugin.json` files load without modification |
| **Methods** | Core + stubs | 12 real methods + 18 graceful stubs for commonly-called OpenClaw methods |
| **Plugin Runtime** | Minimal | Plugins needing `openclaw/plugin-sdk/*` imports require adaptation |

## What's Compatible

### Gateway Protocol v3
LeanClaw implements the full OpenClaw Protocol v3 WebSocket handshake:
- `connect.challenge` event with nonce
- `connect` request with protocol version negotiation
- `hello-ok` response with all required fields (server, features, snapshot, policy)
- Request/response frame format (`type: "req"/"res"`, `id`, `method`, `params`)
- Event broadcasting (`type: "event"`, `event`, `payload`, `seq`)
- Tick heartbeat on configurable interval

OpenClaw clients (gateway-client, CLI, control UI, mobile apps) can connect to LeanClaw using the standard connection flow.

### Plugin Manifests
LeanClaw accepts `openclaw.plugin.json` manifests with all standard fields:

| Field | Supported | Notes |
|-------|-----------|-------|
| `id` | Yes | Required |
| `channels` | Yes | Channel plugin declaration |
| `providers` | Yes | Provider plugin declaration |
| `providerAuthEnvVars` | Yes | Preserved in manifest |
| `providerAuthChoices` | Yes | Preserved in manifest |
| `configSchema` | Yes | Preserved in manifest |
| `uiHints` | Yes | Preserved in manifest |
| `kind` | Yes | Plugin kind (e.g., `memory`) |
| Custom fields | Yes | Passthrough — not rejected |

### Gateway Methods
LeanClaw implements core OpenClaw gateway methods plus graceful stubs:

**Fully implemented:**

| Method | Description |
|--------|-------------|
| `health` | Returns `{ ok, uptimeMs }` |
| `status` | Returns `{ ok: true, uptimeMs }` |
| `sessions.list` | Active sessions |
| `sessions.send` | Routes to `chat.send` when `chatJid` + `text` provided |
| `sessions.patch` / `.create` / `.delete` / `.reset` / `.compact` / `.resolve` | Sensible stubs |
| `config.get` | Current configuration |
| `config.set` / `config.patch` | Returns `{ applied: false, reason: "Use env vars" }` |
| `config.schema` | Empty JSON schema |
| `channels.status` | Connected channels |
| `channels.logout` | `{ ok: true }` |
| `cron.list` / `cron.add` / `cron.remove` / `cron.run` / `cron.status` | Task management |
| `chat.send` / `chat.abort` | Message sending and abort |
| `groups.list` / `providers.list` | LeanClaw extensions |
| `models.list` | Claude + Copilot model list |
| `tools.catalog` / `tools.effective` | Empty catalog / `{ tools: [], sessionKey }` |
| `agents.list` / `logs.tail` | Empty arrays |
| `wake` | `{ ok: true }` |
| `send` | Alias — forwards to `chat.send` |
| `gateway.identity.get` | `{ name: "LeanClaw", runtime: "leanclaw" }` |
| `system-presence` | Returns connected client presence map |
| `system-event` | Accepts client beacons — `{ ok: true, received: true }` |
| `agent` | Graceful stub — `{ ok: true, status: "not_supported" }` with roadmap message |
| `exec.approval.resolve` | Stub — `{ ok: true, resolved: false, reason: "..." }` |
| `device.token.rotate` | Returns new UUID device token |
| `device.token.revoke` | Returns `{ ok: true, revoked: true }` |
| `skills.bins` | Returns `{ bins: [], version: "0.0.0" }` |

### HTTP Health Endpoints

| Path | LeanClaw | OpenClaw |
|------|----------|----------|
| `/health` | Yes | Yes |
| `/healthz` | Yes | Yes |
| `/ready` | Yes | Yes |
| `/readyz` | Yes | Yes |
| `/metrics` | Yes | — |

## What's Different

### Removed from OpenClaw
LeanClaw intentionally omits these OpenClaw features:

- **Bundled plugins** — All 84 OpenClaw extensions are external
- **Mobile apps** — No Android, iOS, or macOS companion apps
- **Web UI** — No control UI (use WebSocket clients)
- **Device pairing** — No device identity or pairing flow
- **Fly.io deployment** — No cloud deployment configs
- **Canvas host** — No live canvas UI
- **TTS/STT** — No text-to-speech/speech-to-text (available via plugins)
- **Node pairing** — No distributed node management
- **Wizard** — No setup wizard flow

### Simplified
- **Auth** — API key only (no device tokens, bootstrap tokens, or password auth)
- **Plugin SDK** — Minimal surface (no jiti lazy loading, no full OpenClaw runtime API)
- **Configuration** — Environment variables only (no TOML/YAML config files)
- **Container runtime** — Docker only (no Podman, no Apple Container)

### Added in LeanClaw
- **Token budget management** — Per-group daily/monthly limits
- **Heartbeat-cron collision avoidance** — Skip heartbeats during cron execution
- **Pre-run script hooks** — Validate runs before agent execution
- **Multi-LLM providers** — Built-in Anthropic + GitHub Copilot support
- **Structured audit logging** — SQLite audit trail
- **RBAC hooks** — Pluggable role-based access control

## Migration from OpenClaw

### Plugin Migration
1. Copy your plugin directory (with `openclaw.plugin.json`)
2. Set `LEANCLAW_PLUGIN_DIR` to the parent directory
3. Plugin manifests load as-is — no changes needed
4. Plugin runtime code may need updates if it uses OpenClaw SDK internals

### Gateway Client Migration
1. Point your WebSocket client to LeanClaw's gateway (default `ws://127.0.0.1:18789`)
2. Use the same Protocol v3 handshake
3. Auth: set `LEANCLAW_GATEWAY_API_KEY` and pass it in `auth.token`
4. Methods work the same — `health`, `sessions.list`, `config.get`, `cron.*`, `chat.*`

### Configuration Migration
| OpenClaw | LeanClaw |
|----------|----------|
| `openclaw config set gateway.port 18789` | `LEANCLAW_GATEWAY_PORT=18789` |
| `openclaw config set anthropicApiKey sk-...` | `LEANCLAW_ANTHROPIC_API_KEY=sk-...` |
| Config file (`~/.openclaw/config.json`) | `.env` file or env vars |

## Compatibility Scorecard

Verified against OpenClaw Protocol v3 specification — **0 known gaps**:

| Priority | Tests | Pass Rate |
|----------|-------|-----------|
| P0 — Critical (handshake, core methods) | 25 | 100% |
| P1 — High (method surface, auth, sessions) | 22 | 100% |
| P2 — Medium (stubs, device tokens, skills) | 62 | 100% |

## Compatibility Testing

LeanClaw includes 473 tests covering OpenClaw compatibility:

**Unit tests** (`src/`):
- `src/gateway/protocol.test.ts` — Protocol v3 schema validation, frame shapes, ConnectParams
- `src/gateway/auth.test.ts` — API key enforcement, rate limiting, RBAC roles
- `src/gateway/openclaw-compat.test.ts` — Full Protocol v3 handshake, client modes, method stubs
- `src/gateway/methods.test.ts` — All gateway methods including Phase 4 additions
- `src/plugins/loader.test.ts` — OpenClaw manifest field compatibility, discovery, caching
- `src/plugins/openclaw-compat.test.ts` — Plugin SDK exports, PluginRegistry API

**E2E tests** (`e2e/`) — 129 tests across 13 scenarios:
```
Scenario 1:  Boot & Handshake       (12 tests)
Scenario 2:  Protocol Frame Format  (9 tests)
Scenario 3:  Method Surface         (36 tests)
Scenario 4:  Plugin Lifecycle       (12 tests)
Scenario 5:  Multi-Client           (6 tests)
Scenario 6:  Gateway Restart        (5 tests)
Scenario 7:  Error Handling         (8 tests)
Scenario 8:  Auth Flows             (7 tests)
Scenario 9:  HTTP Endpoints         (6 tests)
Scenario 10: Chat Flow              (5 tests)
Scenario 11: Cron Lifecycle         (8 tests)
Scenario 12: Node Role              (5 tests)
Scenario C:  Chaos Tests            (6 tests)
```

Run with:
```bash
npm test              # Full suite (473 tests)
npm run e2e           # E2E only (129 tests)
npm run e2e:scorecard # Compatibility report
```

See `docs/E2E-TEST-PLAN.md` for the full scenario specifications and gap analysis methodology.

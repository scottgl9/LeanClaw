# OpenClaw Compatibility

LeanClaw is designed as a lightweight, security-first alternative to OpenClaw while maintaining protocol and plugin compatibility.

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
LeanClaw implements the core OpenClaw gateway methods:

| Method | LeanClaw | OpenClaw | Notes |
|--------|----------|----------|-------|
| `health` | Yes | Yes | Returns uptimeMs |
| `sessions.list` | Yes | Yes | Returns active sessions |
| `config.get` | Yes | Yes | Returns configuration |
| `channels.status` | Yes | Yes | Returns channel status |
| `cron.list` | Yes | Yes | Returns scheduled tasks |
| `cron.add` | Yes | Yes | Create task |
| `cron.remove` | Yes | Yes | Delete task |
| `cron.run` | Yes | Yes | Trigger task |
| `chat.send` | Yes | Yes | Send message |
| `chat.abort` | Yes | Yes | Abort agent |
| `groups.list` | Yes | — | LeanClaw extension |
| `providers.list` | Yes | — | LeanClaw extension |

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

## Compatibility Testing

LeanClaw includes dedicated compatibility tests in:
- `src/gateway/openclaw-compat.test.ts` — Protocol v3 handshake, frame format, client modes
- `src/plugins/openclaw-compat.test.ts` — Real OpenClaw plugin manifest loading

Run with:
```bash
npm test -- --grep "OpenClaw"
```

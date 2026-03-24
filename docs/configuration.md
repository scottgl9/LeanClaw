# Configuration

All LeanClaw configuration is via environment variables with the `LEANCLAW_*` prefix.

## Precedence

1. Environment variables (highest priority)
2. `.env` file in project root
3. Built-in defaults (lowest priority)

## Environment Variables

### Gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `LEANCLAW_GATEWAY_PORT` | `18789` | WebSocket/HTTP gateway port |
| `LEANCLAW_GATEWAY_HOST` | `127.0.0.1` | Gateway bind address |
| `LEANCLAW_GATEWAY_API_KEY` | _(none)_ | API key for gateway auth (open if unset) |

### LLM Providers

| Variable | Default | Description |
|----------|---------|-------------|
| `LEANCLAW_ANTHROPIC_API_KEY` | _(none)_ | Anthropic Claude API key |
| `LEANCLAW_GITHUB_TOKEN` | _(none)_ | GitHub Copilot token |
| `LEANCLAW_DEFAULT_PROVIDER` | `anthropic` | Default provider (`anthropic` or `copilot`) |

### Container

| Variable | Default | Description |
|----------|---------|-------------|
| `LEANCLAW_CONTAINER_IMAGE` | `leanclaw-agent:latest` | Docker image name |
| `LEANCLAW_MAX_CONCURRENT_CONTAINERS` | `5` | Max concurrent containers |
| `LEANCLAW_CONTAINER_TIMEOUT` | `1800000` | Hard timeout per container (ms) |
| `LEANCLAW_IDLE_TIMEOUT` | `1800000` | Idle timeout before closing container (ms) |
| `LEANCLAW_CONTAINER_MAX_OUTPUT_SIZE` | `10485760` | Max stdout/stderr capture (bytes) |

### Runtime

| Variable | Default | Description |
|----------|---------|-------------|
| `LEANCLAW_ASSISTANT_NAME` | `Andy` | Trigger name (e.g., `@Andy`) |
| `LEANCLAW_HEARTBEAT_INTERVAL` | `60000` | Heartbeat check interval (ms) |
| `LEANCLAW_HEARTBEAT_SKIP_WHEN_BUSY` | `true` | Skip heartbeats during cron execution |
| `LEANCLAW_PLUGIN_DIR` | _(none)_ | Directory containing external plugins |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Log level (trace/debug/info/warn/error/fatal) |
| `LOG_FORMAT` | `pretty` | Output format (`pretty` or `json`) |
| `TZ` | System timezone | Timezone for cron expressions |

## Config Files

| File | Location | Purpose |
|------|----------|---------|
| Mount allowlist | `~/.config/leanclaw/mount-allowlist.json` | Allowed mount directories |
| Sender allowlist | `~/.config/leanclaw/sender-allowlist.json` | Per-chat access control |

## CLI

```bash
leanclaw start    # Start the runtime
leanclaw config   # Show current configuration as JSON
leanclaw version  # Show version
leanclaw help     # Show help
```

# Configuration

All LeanClaw configuration is via environment variables with the `LEANCLAW_*` prefix.

## Precedence

1. Environment variables (highest priority)
2. `.env` file in project root
3. Config file at `~/.config/leanclaw/config.json`
4. Built-in defaults (lowest priority)

The `config.set` and `config.patch` gateway methods write changes to `~/.config/leanclaw/config.json` at runtime, broadcasting a `config.changed` event to connected clients.

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
| `LEANCLAW_DEFAULT_PROVIDER` | `anthropic` | Default provider (`anthropic`, `copilot`, or `local`) |

### Local LLM Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `LEANCLAW_LOCAL_LLM_BASE_URL` | _(none)_ | Base URL for OpenAI-compatible server (e.g., `http://localhost:8000/v1`) |
| `LEANCLAW_LOCAL_LLM_API_KEY` | _(none)_ | API key for the local LLM server (if required) |
| `LEANCLAW_LOCAL_LLM_MODEL` | _(auto-discover)_ | Model name; auto-discovers from server's `/v1/models` if unset |

The local provider (registered as `local`) works with vLLM, SGLang, llama.cpp, Ollama, or any OpenAI-compatible server. It supports chat completions for both inference and summarize/compaction.

In `config.json`, use the `localProvider` section:
```json
{
  "localProvider": {
    "baseUrl": "http://localhost:8000/v1",
    "apiKey": "optional-key",
    "model": "my-model"
  }
}
```

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

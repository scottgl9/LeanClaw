# Plugins

LeanClaw supports external plugins using the OpenClaw plugin manifest format. No plugins are bundled — all extensibility is external.

## Plugin Manifest

Place an `openclaw.plugin.json` (or `leanclaw.plugin.json`) in your plugin directory:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "main": "index.js",
  "channels": ["my-channel"],
  "providers": ["my-provider"],
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": { "type": "string" }
    }
  }
}
```

### Manifest Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique plugin identifier |
| `name` | No | Human-readable name (defaults to `id`) |
| `version` | No | Semantic version (defaults to `0.0.0`) |
| `description` | No | Plugin description |
| `main` | No | Entry point module (ESM) |
| `channels` | No | Channel IDs this plugin provides |
| `providers` | No | LLM provider IDs this plugin provides |
| `skills` | No | Skill directories |
| `kind` | No | Plugin kind (e.g., `memory`) |
| `configSchema` | No | JSON Schema for plugin config |
| `providerAuthEnvVars` | No | Env var names for provider auth |
| `providerAuthChoices` | No | Auth method options for UI |

## Loading Plugins

Set `LEANCLAW_PLUGIN_DIR` to the parent directory containing your plugins:

```bash
LEANCLAW_PLUGIN_DIR=./my-plugins leanclaw start
```

Directory structure:
```
my-plugins/
├── my-channel-plugin/
│   ├── openclaw.plugin.json
│   └── index.js
└── my-provider-plugin/
    ├── openclaw.plugin.json
    └── index.js
```

## Writing a Channel Plugin

Export a `createChannel(opts)` function:

```javascript
export function createChannel(opts) {
  return {
    name: 'my-channel',
    async connect() { /* ... */ },
    async sendMessage(jid, text) { /* ... */ },
    isConnected() { return true; },
    ownsJid(jid) { return jid.startsWith('my:'); },
    async disconnect() { /* ... */ },
  };
}
```

The `opts` object provides:
- `opts.onMessage(jid, message)` — Deliver inbound messages to LeanClaw
- `opts.onChatMetadata(jid, timestamp, name, channel, isGroup)` — Chat discovery
- `opts.registeredGroups()` — Get current registered groups

## OpenClaw Compatibility

LeanClaw accepts all standard OpenClaw plugin manifest fields:
- `providerAuthEnvVars` — Environment variable names for provider authentication
- `providerAuthChoices` — Auth method selection for UIs
- `configSchema` — JSON Schema for plugin configuration
- `uiHints` — Frontend hints for config fields
- Additional custom fields are preserved via passthrough

This means existing OpenClaw plugins can be loaded by LeanClaw without modification to their manifests. The plugin's runtime code may need adaptation if it uses OpenClaw-specific SDK internals.

## Example Plugin

See `examples/echo-channel/` for a complete reference implementation.

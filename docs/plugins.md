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

LeanClaw accepts all standard OpenClaw plugin manifest fields — including fields that LeanClaw doesn't act on but preserves for forward compatibility:

- `providerAuthEnvVars` — Environment variable names for provider authentication
- `providerAuthChoices` — Auth method selection for UIs
- `configSchema` — JSON Schema for plugin configuration
- `uiHints` — Frontend hints for config fields
- `kind` — Plugin kind (e.g., `memory`, `provider`, `channel`)
- `contracts` — OpenClaw capability contracts (preserved, not enforced):
  ```json
  {
    "contracts": {
      "speech": { "tts": true, "stt": false },
      "mediaUnderstanding": false,
      "imageGeneration": false,
      "webSearch": false,
      "toolOwnership": ["my-tool"]
    }
  }
  ```
- Additional custom fields are preserved via passthrough

Existing OpenClaw plugins load without manifest modifications.

## TypeScript Plugin Support

LeanClaw supports `.ts` plugin entry points via [jiti](https://github.com/nicolo-ribaudo/jiti) (same loader OpenClaw uses). Just set `"main": "index.ts"` in your `openclaw.plugin.json` — no pre-compilation needed.

```json
{
  "id": "my-ts-plugin",
  "name": "My TypeScript Plugin",
  "version": "1.0.0",
  "main": "index.ts"
}
```

## Plugin SDK — register(api)

Plugins that export a `register(api)` function will be called during load. The `api` object provides methods to register tools, channels, providers, and more:

```typescript
const plugin = {
  register(api) {
    api.registerTool({
      name: 'my_tool',
      description: 'Does something useful',
      parameters: { type: 'object', properties: { input: { type: 'string' } } },
      execute: async (toolCallId, params) => {
        return { result: params.input };
      },
    });
  },
};
export default plugin;
```

Registered tools appear in `tools.catalog` via the gateway WebSocket API. If `register()` throws, the error is logged but the plugin is still considered loaded (partial load is acceptable).

### Plugin Compatibility Testing

LeanClaw's test suite validates manifest compatibility:

```bash
npm test -- --grep "plugin"
```

Tests cover: manifest discovery, all OpenClaw optional fields, `leanclaw.plugin.json` format, invalid manifests (rejected gracefully), registry caching, SDK exports.

## Example Plugin

See `examples/echo-channel/` for a complete reference implementation.

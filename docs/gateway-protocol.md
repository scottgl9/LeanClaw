# Gateway Protocol

LeanClaw implements OpenClaw Protocol v3, providing full compatibility with OpenClaw clients, control UIs, and companion apps.

## Connection

Connect via WebSocket to `ws://127.0.0.1:18789` (configurable via `LEANCLAW_GATEWAY_PORT`).

## Handshake

### Step 1: Server sends `connect.challenge`

```json
{
  "type": "event",
  "event": "connect.challenge",
  "payload": {
    "nonce": "550e8400-e29b-41d4-a716-446655440000",
    "ts": 1711324800000
  }
}
```

### Step 2: Client sends `connect` request

```json
{
  "type": "req",
  "id": "req-1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "gateway-client",
      "version": "2026.3.24",
      "platform": "linux",
      "mode": "backend"
    },
    "role": "operator",
    "scopes": ["operator.admin"],
    "caps": ["tool-events"],
    "auth": {
      "token": "your-api-key"
    }
  }
}
```

### Step 3: Server responds with `hello-ok`

```json
{
  "type": "res",
  "id": "req-1",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 3,
    "server": {
      "version": "0.1.0",
      "connId": "abc-123"
    },
    "features": {
      "methods": ["health", "sessions.list", "config.get", "channels.status", "cron.list", "groups.list", "providers.list", "chat.send", "chat.abort", "cron.add", "cron.remove", "cron.run"],
      "events": ["connect.challenge", "tick", "chat", "agent", "session.message", "health", "cron"]
    },
    "snapshot": {
      "presence": [],
      "health": {},
      "stateVersion": { "presence": 0, "health": 1 },
      "uptimeMs": 12345,
      "authMode": "api-key"
    },
    "policy": {
      "maxPayload": 16777216,
      "maxBufferedBytes": 67108864,
      "tickIntervalMs": 60000
    }
  }
}
```

## Frame Types

### Request (`req`)
```json
{ "type": "req", "id": "unique-id", "method": "method.name", "params": {} }
```

### Response (`res`)
```json
{ "type": "res", "id": "matching-id", "ok": true, "payload": {} }
{ "type": "res", "id": "matching-id", "ok": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```

### Event (`event`)
```json
{ "type": "event", "event": "event.name", "payload": {}, "seq": 1 }
```

## Available Methods

### Read-only
| Method | Description | Returns |
|--------|-------------|---------|
| `health` | Gateway health | `{ ok, uptimeMs }` |
| `sessions.list` | Active sessions | `[{ folder, sessionId }]` |
| `config.get` | Current configuration | `{ gateway, container, provider, ... }` |
| `channels.status` | Connected channels | `[{ name, connected }]` |
| `cron.list` | Scheduled tasks | `[{ id, group, prompt, type, status, ... }]` |
| `groups.list` | Registered groups | `[{ jid, name, folder, isMain }]` |
| `providers.list` | LLM providers | `[{ id, name, configured }]` |

### Interactive
| Method | Description | Params |
|--------|-------------|--------|
| `chat.send` | Send a message | `{ chatJid, text, sender?, senderName? }` |
| `chat.abort` | Stop agent execution | `{ chatJid }` |
| `cron.add` | Create scheduled task | `{ groupFolder, chatJid, prompt, scheduleType, scheduleValue }` |
| `cron.remove` | Delete a task | `{ taskId }` |
| `cron.run` | Run a task immediately | `{ taskId }` |

## Events

| Event | When | Payload |
|-------|------|---------|
| `connect.challenge` | On WebSocket connect | `{ nonce, ts }` |
| `tick` | Every 60s (heartbeat) | `{ ts }` |
| `chat` | Agent produces output | `{ chatJid, group, result, status }` |
| `cron` | Task created/removed via IPC | `{ action, taskId }` |

## Error Codes

| Code | Description |
|------|-------------|
| `INVALID_REQUEST` | Malformed request or protocol mismatch |
| `UNAUTHORIZED` | Missing or invalid authentication |
| `UNAVAILABLE` | Method handler error |
| `RATE_LIMITED` | Too many requests |

## HTTP Endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/health` | GET | Liveness probe (always 200) |
| `/ready` | GET | Readiness probe (503 if unhealthy) |
| `/metrics` | GET | JSON metrics (containers, memory, uptime) |

## Authentication

Set `LEANCLAW_GATEWAY_API_KEY` to require authentication. Clients pass the key in `auth.token` during the connect handshake. If no key is configured, the gateway accepts all connections.

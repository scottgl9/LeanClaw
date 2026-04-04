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
      "methods": ["health", "status", "sessions.list", "sessions.send", "sessions.patch", "sessions.create", "sessions.delete", "sessions.reset", "sessions.compact", "sessions.resolve", "config.get", "config.set", "config.patch", "config.schema", "channels.status", "channels.logout", "cron.list", "cron.add", "cron.remove", "cron.run", "cron.status", "chat.send", "chat.abort", "groups.list", "providers.list", "models.list", "tools.catalog", "tools.effective", "agents.list", "logs.tail", "wake", "send", "gateway.identity.get", "system-presence", "system-event", "agent", "exec.approval.resolve", "device.token.rotate", "device.token.revoke", "skills.bins"],
      "events": ["connect.challenge", "tick", "chat", "agent", "session.message", "health", "cron", "presence", "system", "exec.approval.requested", "shutdown"]
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
| `sessions.send` | Send via session (routes to `chat.send`) | `{ chatJid, text }` |
| `cron.add` | Create scheduled task | `{ groupFolder, chatJid, prompt, scheduleType, scheduleValue }` |
| `cron.remove` | Delete a task | `{ taskId }` |
| `cron.run` | Run a task immediately | `{ taskId }` |

### Presence & Node Methods
| Method | Description | Returns |
|--------|-------------|---------|
| `system-presence` | Connected client presence map | `[{ connId, clientId, mode, platform, ts }]` |
| `system-event` | Accept client beacon | `{ ok: true, received: true }` |
| `agent` | Trigger agent run (stub) | `{ ok: true, status: "not_supported", message: "..." }` |
| `tools.effective` | Session-scoped tool list (real plugin tools, filtered by agent whitelist) | `{ tools: [...], sessionKey }` |
| `exec.approval.resolve` | Resolve exec approval decision | `{ ok: true, resolved: true }` |
| `exec.approval.request` | Request exec approval | `{ ok: true, requestId }` |
| `exec.approval.waitDecision` | Wait for approval decision | `{ ok: true, decision, ... }` |
| `exec.approvals.get` | Get approval policies | `{ policies: [...] }` |
| `exec.approvals.set` | Set approval policies | `{ ok: true }` |
| `device.token.rotate` | Issue new device token | `{ ok: true, deviceToken: "<uuid>", rotatedAt }` |
| `device.token.revoke` | Revoke a device token | `{ ok: true, revoked: true }` |
| `skills.bins` | Available skill executables | `{ bins: [], version: "0.0.0" }` |

### Node Methods
| Method | Description | Params / Returns |
|--------|-------------|------------------|
| `node.list` | List registered nodes | Returns `[{ nodeId, name, caps, connectedAt }]` |
| `node.describe` | Get node details | `{ nodeId }` |
| `node.rename` | Rename a node | `{ nodeId, name }` |
| `node.invoke` | Invoke a method on a node | `{ nodeId, method, params }` |
| `node.invoke.result` | Return result of a node invocation | `{ nodeId, requestId, result }` |
| `node.event` | Send an event to a node | `{ nodeId, event, payload }` |

### Node Pairing
| Method | Description | Params |
|--------|-------------|--------|
| `node.pair.request` | Request pairing with the gateway | `{ name, caps }` |
| `node.pair.list` | List pending pairing requests | _(none)_ |
| `node.pair.approve` | Approve a pairing request | `{ requestId }` |
| `node.pair.reject` | Reject a pairing request | `{ requestId }` |
| `node.pair.verify` | Verify a pairing token | `{ token }` |

### Node Pending Work
| Method | Description | Params |
|--------|-------------|--------|
| `node.pending.enqueue` | Enqueue work for a node | `{ nodeId, work }` (max 64 per node, TTL-based) |
| `node.pending.drain` | Drain all pending work for a node | `{ nodeId }` |
| `node.pending.pull` | Pull next pending work item | `{ nodeId }` |
| `node.pending.ack` | Acknowledge completed work | `{ nodeId, workId }` |

### Session Subscriptions
| Method | Description | Params |
|--------|-------------|--------|
| `sessions.abort` | Abort an active session | `{ sessionId }` |
| `sessions.preview` | Preview session content | `{ sessionId }` |
| `sessions.usage` | Get session token usage | `{ sessionId }` |
| `sessions.subscribe` | Subscribe to session events | `{ sessionId }` |
| `sessions.unsubscribe` | Unsubscribe from session events | `{ sessionId }` |
| `sessions.messages.subscribe` | Subscribe to session message stream | `{ sessionId }` |
| `sessions.messages.unsubscribe` | Unsubscribe from session message stream | `{ sessionId }` |

### Configuration Mutation
| Method | Description | Params |
|--------|-------------|--------|
| `config.set` | Set a configuration value (writes to config.json) | `{ key, value }` |
| `config.patch` | Patch multiple configuration values (writes to config.json) | `{ values: { key: value, ... } }` |

### Agent CRUD
| Method | Description | Params |
|--------|-------------|--------|
| `agents.list` | List all agents | _(none)_ |
| `agents.create` | Create a new agent (SQLite persistence) | `{ name, config, ... }` |
| `agents.update` | Update an existing agent | `{ agentId, ... }` |
| `agents.delete` | Delete an agent | `{ agentId }` |

### Cron Extensions
| Method | Description | Params |
|--------|-------------|--------|
| `cron.update` | Update an existing scheduled task | `{ taskId, ... }` |
| `cron.runs` | Query task run history | `{ taskId? }` |

### Audit
| Method | Description | Params |
|--------|-------------|--------|
| `logs.tail` | Return audit log entries | `{ limit?, offset? }` |

## Events

| Event | When | Payload |
|-------|------|---------|
| `connect.challenge` | On WebSocket connect | `{ nonce, ts }` |
| `tick` | Every 60s (heartbeat) | `{ ts }` |
| `chat` | Agent produces output | `{ chatJid, group, result, status }` |
| `cron` | Task created/removed via IPC | `{ action, taskId }` |
| `presence` | Client presence updates | `{ connId, mode, ... }` |
| `system` | System events / beacons | `{ ... }` |
| `exec.approval.requested` | Exec approval needed | `{ runId, command, ... }` |
| `shutdown` | Gateway shutting down | `{ reason }` |
| `node.connected` | A node registered with the gateway | `{ nodeId, name, caps }` |
| `node.disconnected` | A node disconnected from the gateway | `{ nodeId, reason }` |
| `node.invoke.request` | Invoke request forwarded to a node | `{ nodeId, method, params }` |
| `node.invoke.result` | Result of a node invocation | `{ nodeId, method, result }` |
| `session.aborted` | A session was aborted | `{ sessionId, reason }` |
| `config.changed` | Configuration was mutated | `{ keys, source }` |

## Error Codes

| Code | Description |
|------|-------------|
| `INVALID_REQUEST` | Malformed request or protocol mismatch |
| `UNAUTHORIZED` | Missing or invalid authentication |
| `UNAVAILABLE` | Method handler error |
| `RATE_LIMITED` | Too many requests |
| `NOT_LINKED` | Not connected to a provider |
| `NOT_PAIRED` | Device pairing required |
| `AGENT_TIMEOUT` | Agent execution timed out |
| `NOT_CONNECTED` | Target node is not connected |
| `NOT_FOUND` | Requested resource not found |
| `TIMEOUT` | Operation timed out |

## HTTP Endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/health` | GET, HEAD | Liveness probe (always 200) |
| `/ready` | GET, HEAD | Readiness probe (503 if unhealthy) |
| `/metrics` | GET, HEAD | JSON metrics (containers, memory, uptime) |
| `/health` | POST/PUT/DELETE | 405 Method Not Allowed |

## Authentication

Set `LEANCLAW_GATEWAY_API_KEY` to require authentication. Clients pass the key in `auth.token` during the connect handshake. If no key is configured, the gateway accepts all connections.

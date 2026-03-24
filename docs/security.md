# Security Model

LeanClaw enforces defense-in-depth security through container isolation, mount restrictions, access control, and credential management.

## Container Isolation

Every agent runs in an ephemeral Docker container:
- Isolated filesystem, network, and process namespace
- Containers are created per-invocation and destroyed on exit (`--rm`)
- Non-root execution (user `node`)
- No access to host Docker socket

### Volume Mounts

| Mount | Main Group | Non-Main Groups |
|-------|-----------|-----------------|
| Project root (ro) | `/workspace/project` | Not mounted |
| Group folder (rw) | `/workspace/group` | `/workspace/group` |
| Global memory (ro) | Not mounted | `/workspace/global` |
| `.claude/` sessions | `/home/node/.claude` | `/home/node/.claude` |
| IPC directory | `/workspace/ipc` | `/workspace/ipc` |

### .env Shadowing

The host `.env` file is overlaid with `/dev/null` in containers:
```
/dev/null → /workspace/project/.env (read-only)
```
Agents cannot read host secrets. Credentials are injected via environment variables at container spawn time.

## Mount Allowlist

Additional mounts require explicit approval in `~/.config/leanclaw/mount-allowlist.json`:

```json
{
  "allowedRoots": [
    { "path": "~/projects", "allowReadWrite": true, "description": "Dev projects" },
    { "path": "~/Documents", "allowReadWrite": false, "description": "Read-only docs" }
  ],
  "blockedPatterns": ["password", "secret", "token"],
  "nonMainReadOnly": true
}
```

This file is **never mounted into containers** — agents cannot modify it.

### Blocked Credential Patterns

The following patterns are always blocked from mounts (merged with any user-specified patterns):

`.ssh`, `.gnupg`, `.gpg`, `.aws`, `.azure`, `.gcloud`, `.kube`, `.docker`, `credentials`, `.env`, `.netrc`, `.npmrc`, `.pypirc`, `id_rsa`, `id_ed25519`, `private_key`, `.secret`

### Non-Main Read-Only

When `nonMainReadOnly: true`, non-main groups can only mount directories as read-only, regardless of the root's `allowReadWrite` setting.

## Sender Allowlist

Per-chat access control at `~/.config/leanclaw/sender-allowlist.json`:

```json
{
  "default": { "allow": "*", "mode": "trigger" },
  "chats": {
    "group-123": { "allow": ["alice", "bob"], "mode": "trigger" },
    "spam-group": { "allow": [], "mode": "drop" }
  },
  "logDenied": true
}
```

- `allow: "*"` — Any sender can trigger the agent
- `allow: [...]` — Only listed senders can trigger
- `mode: "trigger"` — Unauthorized messages stored but don't trigger agent
- `mode: "drop"` — Unauthorized messages not stored at all

## Credential Injection

LLM provider credentials (API keys, OAuth tokens) are:
1. Configured via environment variables (`LEANCLAW_ANTHROPIC_API_KEY`, etc.)
2. Never written to disk inside containers
3. Injected as container environment variables at spawn time
4. Not visible to agents in the filesystem

## Rate Limiting

Three levels of rate limiting (sliding window, 60s):
- **Per-IP**: 120 requests/minute on WebSocket connections
- **Per-sender**: 30 messages/minute per sender JID
- **Per-group**: 60 messages/minute per group JID

## RBAC

Pluggable role-based access control with three roles:
- `admin` — Full access
- `user` — Standard operations (no delete)
- `viewer` — Read-only

Default policy allows all operations. Enterprise deployments can override via plugin:

```javascript
import { setRBACPolicy } from 'leanclaw/gateway/auth';

setRBACPolicy((check) => {
  if (check.role === 'admin') return true;
  if (check.role === 'viewer' && check.action === 'read') return true;
  return false;
});
```

## Audit Logging

All security-relevant events are logged to the `audit_log` SQLite table:
- Access attempts (allowed/denied)
- Configuration changes
- Container start/stop with mount lists
- Provider authentication attempts

Enable JSON audit logging for enterprise pipelines:
```bash
LOG_FORMAT=json leanclaw start
```

## IPC Authorization

The IPC watcher enforces group-level authorization:
- **Main group** can send messages to any chat, register groups, and manage all tasks
- **Non-main groups** can only send to their own chat and manage their own tasks
- **Group registration** is restricted to the main group only
- Agents cannot set `isMain` via IPC (defense in depth)

# LeanClaw E2E Test Plan

## Purpose

Validate LeanClaw's **end-to-end compatibility with the OpenClaw ecosystem** — gateway protocol, plugin loading, channel lifecycle, and runtime behavior — by testing against the real OpenClaw gateway protocol v3 specification and plugin architecture.

**Goal:** Find every protocol mismatch, missing method, wrong response shape, lifecycle gap, and failure-mode difference between LeanClaw and OpenClaw so we can prioritize fixes for real-world compatibility.

---

## Test Architecture

### Approach: Black-Box Protocol Testing

We test LeanClaw the way a **real OpenClaw client** (macOS app, CLI, WebChat, node) would interact with it:

1. Start LeanClaw gateway on a test port
2. Connect via WebSocket as various client types
3. Exercise the full protocol surface
4. Assert response shapes match OpenClaw spec
5. Inject failures and verify graceful degradation

### Stack

| Component | Tool | Why |
|-----------|------|-----|
| Test runner | **Vitest** | Already in LeanClaw; fast, TypeScript-native |
| WebSocket client | **ws** | Already a dependency |
| HTTP assertions | **Node fetch** | Built-in, no extra deps |
| Process management | **Node child_process** | For boot/restart scenarios |
| Fixtures | JSON files in `e2e/fixtures/` | Versioned contract payloads |
| Artifacts | `e2e/artifacts/<timestamp>/` | Logs + traces per run |

### Directory Structure

```
e2e/
├── README.md                      # How to run E2E tests
├── helpers/
│   ├── client.ts                  # OpenClaw-compatible WS client helper
│   ├── server-lifecycle.ts        # Start/stop/restart LeanClaw for tests
│   ├── assertions.ts              # Reusable protocol shape assertions
│   └── artifact-capture.ts        # Log/trace capture per test run
├── fixtures/
│   ├── connect-params/
│   │   ├── operator.json          # Standard operator connect params
│   │   ├── cli.json               # CLI-mode connect params
│   │   ├── node.json              # Node-role connect params (caps/commands)
│   │   ├── ui.json                # Control UI connect params
│   │   └── macos-app.json         # macOS app with device attestation
│   ├── plugins/
│   │   ├── echo-plugin/           # Minimal test plugin (openclaw.plugin.json)
│   │   ├── crash-plugin/          # Plugin that throws on load
│   │   ├── slow-plugin/           # Plugin with delayed responses
│   │   └── channel-plugin/        # Plugin that registers a channel
│   └── contracts/
│       ├── hello-ok.schema.json   # Expected hello-ok response shape
│       ├── error.schema.json      # Expected error response shape
│       └── event.schema.json      # Expected event frame shape
├── scenarios/
│   ├── 01-boot-handshake.test.ts
│   ├── 02-protocol-frames.test.ts
│   ├── 03-method-surface.test.ts
│   ├── 04-plugin-lifecycle.test.ts
│   ├── 05-multi-client.test.ts
│   ├── 06-gateway-restart.test.ts
│   ├── 07-error-handling.test.ts
│   ├── 08-auth-flows.test.ts
│   ├── 09-http-endpoints.test.ts
│   ├── 10-chat-send-flow.test.ts
│   ├── 11-cron-lifecycle.test.ts
│   └── 12-node-role.test.ts
├── scorecard.ts                   # Generates compatibility report
└── artifacts/                     # Generated per-run (gitignored)
    └── .gitkeep
```

---

## Scenarios

### Scenario 1: Boot & Handshake (`01-boot-handshake.test.ts`)

**What:** Verify LeanClaw gateway starts cleanly and completes the Protocol v3 handshake identically to OpenClaw.

**Tests:**

| # | Test | Expected | Priority |
|---|------|----------|----------|
| 1.1 | Gateway starts on configured port | HTTP /health returns 200 within 5s | P0 |
| 1.2 | WS connect receives `connect.challenge` event | `{type:"event", event:"connect.challenge", payload:{nonce:string, ts:number}}` | P0 |
| 1.3 | Challenge nonce is unique per connection | Two connections get different nonces | P1 |
| 1.4 | Valid `connect` request returns `hello-ok` | `{type:"res", ok:true, payload:{type:"hello-ok", protocol:3, ...}}` | P0 |
| 1.5 | `hello-ok` contains all required fields | `server.version`, `server.connId`, `features.methods[]`, `features.events[]`, `snapshot.presence[]`, `snapshot.health`, `snapshot.stateVersion`, `snapshot.uptimeMs`, `snapshot.authMode`, `policy.maxPayload`, `policy.maxBufferedBytes`, `policy.tickIntervalMs` | P0 |
| 1.6 | `hello-ok.auth` block is present | `deviceToken`, `role`, `scopes` | P0 |
| 1.7 | Protocol version 3 negotiated | `payload.protocol === 3` | P0 |
| 1.8 | Old protocol versions rejected | minProtocol:1, maxProtocol:2 → error + close | P0 |
| 1.9 | Future protocol versions rejected | minProtocol:99, maxProtocol:99 → error + close | P1 |
| 1.10 | Handshake timeout enforced | No `connect` within 30s → socket closed with 4408 | P1 |
| 1.11 | Invalid JSON rejected | Send garbage bytes → error response | P1 |
| 1.12 | Missing `connect` as first request | Send `health` before `connect` → UNAUTHORIZED | P0 |

**Known risks:**
- `hello-ok` shape may be missing fields that OpenClaw clients expect (e.g., `snapshot.sessionDefaults`, `canvasHostUrl`)
- `features.events` list may be incomplete vs what OpenClaw clients subscribe to

---

### Scenario 2: Protocol Frame Format (`02-protocol-frames.test.ts`)

**What:** Verify wire-level frame format matches OpenClaw spec exactly.

**Tests:**

| # | Test | Expected | Priority |
|---|------|----------|----------|
| 2.1 | Request frame: `{type:"req", id, method, params}` | Exact field names, types | P0 |
| 2.2 | Response frame mirrors request `id` | `res.id === req.id` | P0 |
| 2.3 | Success response: `{type:"res", id, ok:true, payload}` | Exact shape | P0 |
| 2.4 | Error response: `{type:"res", id, ok:false, error:{code, message}}` | Exact shape | P0 |
| 2.5 | Error `code` uses OpenClaw error code enum | `INVALID_REQUEST`, `UNAUTHORIZED`, `UNAVAILABLE`, `RATE_LIMITED`, `AGENT_TIMEOUT` | P0 |
| 2.6 | Event frames: `{type:"event", event, payload, seq}` | Exact shape | P0 |
| 2.7 | Event `seq` increments monotonically | seq(n+1) > seq(n) for broadcast events | P1 |
| 2.8 | Oversized payload rejected | Send > 16MB → error or close | P2 |
| 2.9 | `stateVersion` present on presence events | If OpenClaw clients expect it | P2 |

**Known risks:**
- Error response may be missing `error.details`, `error.retryable`, `error.retryAfterMs` fields
- Event frames may not include `stateVersion` field that some clients use for delta sync

---

### Scenario 3: Method Surface Completeness (`03-method-surface.test.ts`)

**What:** Verify all methods that OpenClaw clients call are registered and return compatible response shapes.

**Tests:**

| # | Test | Method | Expected Response | Priority |
|---|------|--------|-------------------|----------|
| 3.1 | Health | `health` | `{ok:true, uptimeMs:number}` | P0 |
| 3.2 | Status | `status` | `{ok:true, ...}` | P0 |
| 3.3 | Sessions list | `sessions.list` | `Array<{...}>` | P0 |
| 3.4 | Sessions create | `sessions.create` | Graceful response (even if stub) | P1 |
| 3.5 | Sessions patch | `sessions.patch` | `{ok:true}` | P1 |
| 3.6 | Sessions delete | `sessions.delete` | `{ok:true}` | P1 |
| 3.7 | Sessions send | `sessions.send` | Response or redirect to `chat.send` | P1 |
| 3.8 | Sessions resolve | `sessions.resolve` | `null` or session object | P2 |
| 3.9 | Sessions reset | `sessions.reset` | `{ok:true}` | P2 |
| 3.10 | Sessions compact | `sessions.compact` | `{ok:true}` | P2 |
| 3.11 | Config get | `config.get` | Object with config data | P0 |
| 3.12 | Config set | `config.set` | Graceful not-supported or applied | P1 |
| 3.13 | Config patch | `config.patch` | Graceful not-supported or applied | P1 |
| 3.14 | Config schema | `config.schema` | JSON schema object | P2 |
| 3.15 | Channels status | `channels.status` | `Array<{name, connected}>` | P0 |
| 3.16 | Channels logout | `channels.logout` | `{ok:true}` | P2 |
| 3.17 | Cron list | `cron.list` | `Array<{...}>` | P0 |
| 3.18 | Cron status | `cron.status` | `{running:boolean}` | P1 |
| 3.19 | Cron add | `cron.add` | `{taskId, nextRun}` | P1 |
| 3.20 | Cron remove | `cron.remove` | `{removed:true}` | P1 |
| 3.21 | Cron run | `cron.run` | `{queued:true}` | P2 |
| 3.22 | Models list | `models.list` | `Array<{id, provider, name}>` | P0 |
| 3.23 | Groups list | `groups.list` | `Array<{...}>` | P1 |
| 3.24 | Providers list | `providers.list` | `Array<{id, name, configured}>` | P1 |
| 3.25 | Tools catalog | `tools.catalog` | `Array<{...}>` or `[]` | P1 |
| 3.26 | Agents list | `agents.list` | `Array<{...}>` or `[]` | P2 |
| 3.27 | Logs tail | `logs.tail` | `Array<{...}>` or `[]` | P2 |
| 3.28 | Gateway identity | `gateway.identity.get` | `{name, version, runtime}` | P0 |
| 3.29 | Wake | `wake` | `{ok:true}` | P2 |
| 3.30 | Send (legacy) | `send` | Routes to `chat.send` or returns error | P1 |
| 3.31 | Chat send | `chat.send` | `{messageId, piped}` | P0 |
| 3.32 | Chat abort | `chat.abort` | `{aborted:true}` | P1 |
| 3.33 | System presence | `system-presence` | Presence object/array | P1 |
| 3.34 | System event | `system-event` | Accept beacon | P2 |

**Known risks / likely gaps:**
- **`system-presence`** — not registered in LeanClaw server.ts → will return `Unknown method`
- **`system-event`** — not registered → will return `Unknown method`
- **`tools.effective`** — not registered → will return `Unknown method`
- **`sessions.send`** — returns `{error}` instead of routing properly
- **`agent`** method — not present (OpenClaw uses this for triggering agent runs from UI)
- **`exec.approval.resolve`** — not present (exec approval flow)
- **`device.token.rotate`** / `device.token.revoke` — not present
- **`skills.bins`** — not present (node helper)

---

### Scenario 4: Plugin Lifecycle (`04-plugin-lifecycle.test.ts`)

**What:** Verify LeanClaw discovers, loads, and handles plugins compatible with OpenClaw's `openclaw.plugin.json` format.

**Tests:**

| # | Test | Expected | Priority |
|---|------|----------|----------|
| 4.1 | Discovers `openclaw.plugin.json` in plugin dir | Plugin appears in registry | P0 |
| 4.2 | Discovers `leanclaw.plugin.json` in plugin dir | Plugin appears in registry | P0 |
| 4.3 | Loads plugin with `main` module | Runtime module available | P0 |
| 4.4 | Plugin without `main` loads as metadata-only | Status: loaded, no runtime | P1 |
| 4.5 | Invalid manifest rejected gracefully | Warning logged, other plugins still load | P0 |
| 4.6 | Plugin that throws on import | Status: error, error message captured | P0 |
| 4.7 | Plugin with `channels` array | Channel names registered | P1 |
| 4.8 | Plugin with `skills` array | Skills paths discovered | P1 |
| 4.9 | Plugin with `providers` array | Provider names registered | P1 |
| 4.10 | OpenClaw-specific manifest fields accepted | `kind`, `contracts`, `configSchema`, etc. pass validation | P0 |
| 4.11 | Plugin registry exposes list/get API | Matches expected interface | P1 |
| 4.12 | Multiple plugins in same dir | All discovered, no conflicts | P1 |

**Known risks:**
- LeanClaw's plugin loader does discovery + manifest parse only — no `register(api)` SDK pattern like OpenClaw
- Plugin `contracts` field (speech/tts/stt, mediaUnderstanding, etc.) is parsed but not acted on
- No `definePluginEntry` / `api.registerTool()` / `api.registerChannel()` pattern — major gap for real OpenClaw plugins

---

### Scenario 5: Multi-Client Connections (`05-multi-client.test.ts`)

**What:** Verify multiple simultaneous WebSocket clients work correctly.

**Tests:**

| # | Test | Expected | Priority |
|---|------|----------|----------|
| 5.1 | Two clients connect simultaneously | Both get hello-ok, unique connIds | P0 |
| 5.2 | Broadcast events reach all authenticated clients | Tick event received by both | P0 |
| 5.3 | One client disconnect doesn't affect others | Remaining client still works | P0 |
| 5.4 | Client with different modes (backend, cli, ui, node) | All accepted | P1 |
| 5.5 | Presence reflects connected clients | hello-ok snapshot shows peer | P1 |
| 5.6 | 10 concurrent connections | All functional, no resource exhaustion | P2 |

---

### Scenario 6: Gateway Restart Recovery (`06-gateway-restart.test.ts`)

**What:** Verify LeanClaw handles restart gracefully and clients can reconnect.

**Tests:**

| # | Test | Expected | Priority |
|---|------|----------|----------|
| 6.1 | Clean shutdown closes all WS connections | Clients receive close frame (1001) | P0 |
| 6.2 | Restart on same port succeeds | New connections work after restart | P0 |
| 6.3 | State survives restart (DB persistence) | sessions, tasks, router state persisted | P1 |
| 6.4 | Client reconnects after restart | New handshake succeeds | P0 |
| 6.5 | Pending requests during shutdown | Clients get error or close, no hang | P1 |

---

### Scenario 7: Error Handling & Edge Cases (`07-error-handling.test.ts`)

**What:** Verify error paths match OpenClaw error contract.

**Tests:**

| # | Test | Expected | Priority |
|---|------|----------|----------|
| 7.1 | Unknown method returns INVALID_REQUEST | `{ok:false, error:{code:"INVALID_REQUEST"}}` | P0 |
| 7.2 | Method handler throws | `{ok:false, error:{code:"UNAVAILABLE"}}` | P0 |
| 7.3 | Malformed JSON | Error response, not crash | P0 |
| 7.4 | Missing required params | Error with clear message | P1 |
| 7.5 | Rapid-fire requests | All get responses, no dropped | P1 |
| 7.6 | Binary WebSocket frame | Handled gracefully (rejected or ignored) | P2 |
| 7.7 | Empty message body | Error response | P2 |
| 7.8 | Very long method name | Error response, no crash | P2 |

---

### Scenario 8: Authentication Flows (`08-auth-flows.test.ts`)

**What:** Verify auth behavior matches OpenClaw when `LEANCLAW_GATEWAY_API_KEY` is set.

**Tests:**

| # | Test | Expected | Priority |
|---|------|----------|----------|
| 8.1 | No API key configured → open access | Connect without token succeeds | P0 |
| 8.2 | API key configured → token required | Connect without token → UNAUTHORIZED + close | P0 |
| 8.3 | Correct token accepted | hello-ok returned | P0 |
| 8.4 | Wrong token rejected | UNAUTHORIZED + close (4401) | P0 |
| 8.5 | Rate limiting by IP | Exceed limit → 4429 close | P1 |
| 8.6 | `hello-ok.auth.deviceToken` issued | Token is non-empty string | P1 |
| 8.7 | Device token can be used for reconnect | (Gap: LeanClaw doesn't persist device tokens yet) | P2 |

**Known risks:**
- LeanClaw doesn't implement device identity signing (`connect.challenge` nonce signing) — it accepts nonce but doesn't verify signatures
- No device pairing store — `hello-ok.auth.deviceToken` is the `connId` UUID, not a persistent token
- No `device.token.rotate` / `device.token.revoke` methods

---

### Scenario 9: HTTP Endpoints (`09-http-endpoints.test.ts`)

**What:** Verify HTTP health/readiness/metrics endpoints match expectations.

**Tests:**

| # | Test | Expected | Priority |
|---|------|----------|----------|
| 9.1 | GET /health → 200 | `{ok:true, status:"live"}` | P0 |
| 9.2 | GET /ready → 200 | `{ready:true, ...}` | P0 |
| 9.3 | GET /metrics → 200 | `{uptime, memoryUsageMb, ...}` | P1 |
| 9.4 | GET /unknown → 404 | `{error:"Not found"}` | P1 |
| 9.5 | HEAD /health → 200 | No body | P2 |
| 9.6 | POST /health → 404 or 405 | Not a valid method | P2 |

---

### Scenario 10: Chat Send Flow (`10-chat-send-flow.test.ts`)

**What:** Verify the `chat.send` method works end-to-end and broadcasts events.

**Tests:**

| # | Test | Expected | Priority |
|---|------|----------|----------|
| 10.1 | `chat.send` with valid params | Returns `{messageId, piped}` | P0 |
| 10.2 | `chat.send` missing chatJid | Error thrown | P0 |
| 10.3 | `chat.send` missing text | Error thrown | P0 |
| 10.4 | `chat.abort` with valid chatJid | Returns `{aborted:true}` | P1 |
| 10.5 | Message stored in DB | Can be retrieved after send | P1 |

---

### Scenario 11: Cron/Task Lifecycle (`11-cron-lifecycle.test.ts`)

**What:** Verify scheduled task CRUD via gateway methods.

**Tests:**

| # | Test | Expected | Priority |
|---|------|----------|----------|
| 11.1 | `cron.add` with cron expression | Returns `{taskId, nextRun}` | P1 |
| 11.2 | `cron.add` with interval | Returns `{taskId, nextRun}` | P1 |
| 11.3 | `cron.add` with once timestamp | Returns `{taskId, nextRun}` | P2 |
| 11.4 | `cron.list` shows added task | Task in array | P1 |
| 11.5 | `cron.remove` deletes task | Task no longer in list | P1 |
| 11.6 | `cron.run` triggers immediate exec | Returns `{queued:true}` | P2 |
| 11.7 | `cron.add` with invalid expression | Error thrown | P1 |
| 11.8 | Broadcast event on task add/remove | `event:cron` received by clients | P2 |

---

### Scenario 12: Node Role Connect (`12-node-role.test.ts`)

**What:** Verify that `role: "node"` connections are accepted with caps/commands/permissions.

**Tests:**

| # | Test | Expected | Priority |
|---|------|----------|----------|
| 12.1 | Node connect with caps array | hello-ok accepted | P1 |
| 12.2 | Node connect with commands array | hello-ok accepted | P1 |
| 12.3 | Node connect with permissions object | hello-ok accepted | P1 |
| 12.4 | Node connect with full device attestation | hello-ok accepted | P1 |
| 12.5 | Node methods after connect | Can call registered methods | P1 |

---

## Compatibility Gap Analysis (Pre-Test Predictions)

Based on code review, these are the **likely compatibility gaps** before running tests:

### Critical (P0) — Will break OpenClaw clients

| Gap | LeanClaw Current | OpenClaw Expected | Impact |
|-----|-------------------|-------------------|--------|
| No device identity verification | Accepts but ignores `device.signature` | Verifies challenge nonce signature | macOS app / iOS node will fail connect in strict mode |
| Missing `system-presence` method | Not registered | Returns presence map | macOS app Instances tab broken |
| Missing `system-event` method | Not registered | Accepts periodic beacons | macOS app health reporting broken |
| Missing `agent` method | Not registered | Triggers agent run from UI | Core "send prompt from UI" broken |
| No plugin `register(api)` pattern | Discovery + manifest only | Full SDK with `registerTool`, `registerChannel`, etc. | Real OpenClaw plugins won't load |
| `hello-ok.policy.tickIntervalMs` = 60000 | 60s tick | OpenClaw default is 15s | UI may show "disconnected" warnings |

### High (P1) — Degraded experience

| Gap | LeanClaw Current | OpenClaw Expected | Impact |
|-----|-------------------|-------------------|--------|
| `sessions.send` returns error | `{error: "Use chat.send"}` | Routes message to session | CLI `openclaw send` won't work |
| No `tools.effective` method | Not registered | Returns session-scoped tool list | UI tool inspector broken |
| No `exec.approval.*` methods | Not registered | Approval flow for shell commands | Exec approval workflow broken |
| No idempotency key handling | Not checked | Required for `send`, `agent` | Retry-safety not guaranteed |
| `snapshot.sessionDefaults` missing | Not in hello-ok | May be expected by some clients | Minor, some UI defaults missing |
| No `canvasHostUrl` in hello-ok | Not present | Canvas URL for agent HTML | Canvas feature unavailable |

### Medium (P2) — Missing features, not breaking

| Gap | LeanClaw Current | OpenClaw Expected | Impact |
|-----|-------------------|-------------------|--------|
| No `device.token.rotate/revoke` | Not registered | Token lifecycle management | Can't rotate/revoke device tokens |
| No `skills.bins` | Not registered | Node auto-allow checks | Node skill exec degraded |
| No `chat.steer` / queue modes | Not implemented | Steer/collect/followup | Message handling less sophisticated |
| Rate limiting is IP-only | Per-IP only | Per-IP + per-sender + per-group | Less granular throttling |

---

## Execution Plan

### Phase 1: Foundation (Week 1)
- [ ] Create `e2e/` directory structure
- [ ] Build `e2e/helpers/client.ts` — reusable OpenClaw-compatible WS client
- [ ] Build `e2e/helpers/server-lifecycle.ts` — start/stop LeanClaw programmatically
- [ ] Build `e2e/helpers/assertions.ts` — protocol shape validators
- [ ] Implement Scenario 1 (Boot & Handshake) — 12 tests
- [ ] Implement Scenario 2 (Protocol Frames) — 9 tests
- [ ] Implement Scenario 9 (HTTP Endpoints) — 6 tests
- [ ] Run and capture first compatibility scorecard

### Phase 2: Method Surface (Week 2)
- [ ] Create connect param fixtures (operator, cli, node, ui, macos-app)
- [ ] Implement Scenario 3 (Method Surface) — 34 tests
- [ ] Implement Scenario 8 (Auth Flows) — 7 tests
- [ ] Implement Scenario 12 (Node Role) — 5 tests
- [ ] Update scorecard with method-level pass/fail

### Phase 3: Lifecycle & Integration (Week 3)
- [ ] Create test plugin fixtures (echo, crash, slow, channel)
- [ ] Implement Scenario 4 (Plugin Lifecycle) — 12 tests
- [ ] Implement Scenario 5 (Multi-Client) — 6 tests
- [ ] Implement Scenario 6 (Gateway Restart) — 5 tests
- [ ] Implement Scenario 10 (Chat Send) — 5 tests
- [ ] Implement Scenario 11 (Cron Lifecycle) — 8 tests

### Phase 4: Error Paths & Hardening (Week 4)
- [ ] Implement Scenario 7 (Error Handling) — 8 tests
- [ ] Add artifact capture (logs per run)
- [ ] Build `e2e/scorecard.ts` — automated compatibility report generator
- [ ] Add `npm run e2e` script
- [ ] Final scorecard + prioritized fix list

---

## Run Commands

```bash
# Run all E2E tests
npm run e2e

# Run specific scenario
npx vitest run e2e/scenarios/01-boot-handshake.test.ts

# Run with verbose logging
LOG_LEVEL=debug npm run e2e

# Generate compatibility scorecard
npx tsx e2e/scorecard.ts
```

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Scenario 1-3 pass rate | 100% |
| Scenario 4-12 pass rate | >80% |
| P0 gaps identified and documented | 100% |
| P1 gaps identified and documented | 100% |
| Single-command E2E run works | Yes |
| Scorecard generated automatically | Yes |
| Fix priority list produced | Yes |

---

## References

- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol) — Canonical protocol v3 spec
- [OpenClaw Plugin Architecture](https://docs.openclaw.ai/tools/plugin) — Plugin system docs
- [OpenClaw Architecture Overview](https://docs.openclaw.ai/concepts/architecture) — System design
- LeanClaw source: `~/sandbox/personal/LeanClaw/src/`
- Existing unit tests: `src/**/*.test.ts` (233 tests passing)

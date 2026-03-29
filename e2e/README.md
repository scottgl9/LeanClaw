# LeanClaw E2E Tests

End-to-end compatibility tests validating LeanClaw against the OpenClaw Protocol v3 gateway and plugin architecture. Tests connect via real WebSocket as OpenClaw clients and assert black-box protocol behavior.

## Quick Start

```bash
# Run all E2E tests
npm run e2e

# Generate compatibility scorecard
npm run e2e:scorecard

# Run specific scenario
npx vitest run e2e/scenarios/01-boot-handshake.test.ts --pool=forks --no-file-parallelism
```

## Structure

```
e2e/
├── README.md
├── helpers/
│   ├── client.ts           # OpenClaw-compatible WS client helper
│   ├── assertions.ts       # Protocol shape validators (assertHelloOkShape, etc.)
│   └── artifact-capture.ts # Per-run log capture
├── fixtures/
│   ├── connect-params/     # Client connect param JSON fixtures
│   │   ├── operator.json   # Standard operator client
│   │   ├── cli.json        # CLI-mode client
│   │   ├── ui.json         # Control UI client
│   │   ├── backend.json    # Backend/daemon client
│   │   └── node.json       # Node-role with caps/commands
│   └── plugins/            # Test plugin manifests
│       ├── echo-plugin/    # Basic manifest + module
│       ├── metadata-only-plugin/  # No main field
│       ├── leanclaw-format-plugin/ # leanclaw.plugin.json format
│       ├── invalid-manifest-plugin/ # Bad JSON (tests graceful rejection)
│       ├── channel-plugin/ # Declares a channel
│       └── openclaw-contracts-plugin/ # Full OpenClaw contracts fields
├── scenarios/
│   ├── 01-boot-handshake.test.ts    # Gateway start, connect.challenge, hello-ok
│   ├── 02-protocol-frames.test.ts   # Wire-level frame validation
│   ├── 03-method-surface.test.ts    # All 34+ gateway methods
│   ├── 04-plugin-lifecycle.test.ts  # Plugin discovery, manifests, registry
│   ├── 05-multi-client.test.ts      # Concurrent connections, broadcasts
│   ├── 06-gateway-restart.test.ts   # Clean shutdown, reconnect, restart cycles
│   ├── 07-error-handling.test.ts    # Malformed payloads, rapid-fire requests
│   ├── 08-auth-flows.test.ts        # API key enforcement, token issuance
│   ├── 09-http-endpoints.test.ts    # /health, /ready, /metrics, 405 handling
│   ├── 10-chat-flow.test.ts         # chat.send / chat.abort
│   ├── 11-cron-lifecycle.test.ts    # Task CRUD via gateway
│   ├── 12-node-role.test.ts         # Node role with caps/commands/permissions
│   └── 12-chaos.test.ts             # Failure injection, concurrent load
├── scorecard.ts             # Compatibility report generator
└── artifacts/               # Generated per-run (gitignored)
```

## Scenarios

| # | Scenario | Tests | Coverage |
|---|----------|-------|---------|
| 1 | Boot & Handshake | 12 | `connect.challenge`, `hello-ok` shape, protocol version negotiation |
| 2 | Protocol Frames | 9 | Wire format, id mirroring, error shape, seq incrementing |
| 3 | Method Surface | 36 | All gateway methods — response shapes + gap documentation |
| 4 | Plugin Lifecycle | 12 | OpenClaw manifest discovery, `leanclaw.plugin.json`, registry API |
| 5 | Multi-Client | 6 | Concurrent connections, broadcast delivery, disconnect isolation |
| 6 | Gateway Restart | 5 | Clean shutdown, same-port restart, reconnect after restart |
| 7 | Error Handling | 8 | Invalid JSON, unknown methods, rapid-fire, missing fields |
| 8 | Auth Flows | 7 | API key enforcement, token issuance, role/scope reflection |
| 9 | HTTP Endpoints | 6 | `/health`, `/ready`, `/metrics`, 404, 405 |
| 10 | Chat Flow | 5 | `chat.send` / `chat.abort` with DB initialization |
| 11 | Cron Lifecycle | 8 | `cron.add` / `cron.list` / `cron.remove` / `cron.run`, broadcast |
| 12 | Node Role | 5 | `role: "node"` with caps/commands/permissions/device attestation |
| C | Chaos Tests | 6 | Handler throws, garbage input, 100 concurrent requests, mid-handshake close |

## Compatibility Results

```
P0 (Critical — handshake, core methods): 25/25 ✅
P1 (High — method surface, auth):        22/22 ✅
P2 (Medium — stubs, device tokens):      62/62 ✅
Known gaps: 0
```

## Implementation Notes

- All tests start a real `startGatewayServer()` on unique ports (31000+ range)
- Tests use `afterEach` to close servers — no leaked sockets
- Port range `31000-32199` reserved for E2E (unit tests use 19000-29999)
- DB-requiring tests (`chat.send`, `cron.*`) initialize a temp SQLite DB in `beforeAll`
- Auth tests set/restore `process.env['LEANCLAW_GATEWAY_API_KEY']` around test blocks
- Runs with `--pool=forks --no-file-parallelism` to avoid SQLite contention

## Full Plan

See `docs/E2E-TEST-PLAN.md` for the complete scenario specifications, gap analysis methodology, and phased execution plan.

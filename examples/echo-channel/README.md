# Echo Channel Plugin

A reference channel plugin for LeanClaw that demonstrates the full plugin contract.

## What it does

- Registers as the `echo` channel
- Owns any JID starting with `echo:`
- Stores sent/received messages in-memory for testing
- Provides `simulateMessage()` to inject test messages

## Usage

```bash
# Point LeanClaw to the examples directory
LEANCLAW_PLUGIN_DIR=./examples leanclaw start
```

## Plugin Structure

```
echo-channel/
├── openclaw.plugin.json  # Plugin manifest (OpenClaw-compatible)
├── index.js              # Channel implementation
└── README.md             # This file
```

## API

### `createChannel(opts)` — Channel Factory

Called by LeanClaw when the plugin is loaded. Returns a `Channel` object with:

- `connect()` — Initialize the channel
- `sendMessage(jid, text)` — Send a message to a user/group
- `isConnected()` — Check if channel is active
- `ownsJid(jid)` — Return true if this channel handles the given JID
- `disconnect()` — Clean up resources

### `simulateMessage(jid, sender, senderName, content)` — Test Helper

Inject a message as if it came from a user. Triggers the `onMessage` callback.

### `getOutbox()` / `getInbox()` — Inspect Messages

Retrieve stored messages for assertions in tests.

## Writing Your Own Channel Plugin

1. Create a directory with `openclaw.plugin.json`:
   ```json
   {
     "id": "my-channel",
     "name": "My Channel",
     "version": "1.0.0",
     "main": "index.js",
     "channels": ["my-channel"]
   }
   ```

2. Export a `createChannel(opts)` function that returns a `Channel` object

3. Use `opts.onMessage(jid, message)` to deliver inbound messages to LeanClaw

4. Use `opts.onChatMetadata(jid, timestamp, name, channel, isGroup)` for chat discovery

5. Set `LEANCLAW_PLUGIN_DIR` to the parent directory and start LeanClaw

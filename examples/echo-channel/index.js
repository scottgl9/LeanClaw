/**
 * Echo Channel Plugin for LeanClaw
 *
 * A reference channel implementation that demonstrates the full plugin contract.
 * Messages sent to this channel are stored in-memory and can be retrieved via
 * the getMessages() helper for testing.
 *
 * Usage:
 *   Set LEANCLAW_PLUGIN_DIR to the parent directory containing this plugin.
 *   The channel self-registers as "echo" and accepts any JID starting with "echo:".
 *
 * Example:
 *   LEANCLAW_PLUGIN_DIR=./examples leanclaw start
 */

// In-memory message store for testing
const inbox = [];
const outbox = [];
let connected = false;
let onMessageCallback = null;
let onChatMetadataCallback = null;

/**
 * Channel factory — called by LeanClaw's channel registry.
 * Returns a Channel object implementing the required interface.
 */
export function createChannel(opts) {
  onMessageCallback = opts.onMessage;
  onChatMetadataCallback = opts.onChatMetadata;

  return {
    name: 'echo',

    async connect() {
      connected = true;
      console.log('[echo-channel] Connected');
    },

    async sendMessage(jid, text) {
      outbox.push({ jid, text, timestamp: new Date().toISOString() });
      console.log(`[echo-channel] → ${jid}: ${text.slice(0, 100)}`);
    },

    isConnected() {
      return connected;
    },

    ownsJid(jid) {
      return jid.startsWith('echo:');
    },

    async disconnect() {
      connected = false;
      console.log('[echo-channel] Disconnected');
    },

    async setTyping(jid, isTyping) {
      // No-op for echo channel
    },
  };
}

/**
 * Simulate an inbound message (for testing).
 * Call this to inject a message as if it came from a user.
 */
export function simulateMessage(jid, sender, senderName, content) {
  const message = {
    id: `echo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chat_jid: jid,
    sender,
    sender_name: senderName,
    content,
    timestamp: new Date().toISOString(),
  };

  inbox.push(message);

  if (onMessageCallback) {
    onMessageCallback(jid, message);
  }
  if (onChatMetadataCallback) {
    onChatMetadataCallback(jid, message.timestamp, senderName, 'echo', false);
  }

  return message;
}

/** Get all messages sent TO this channel (outbound from agent). */
export function getOutbox() {
  return [...outbox];
}

/** Get all messages received BY this channel (inbound from users). */
export function getInbox() {
  return [...inbox];
}

/** Clear message stores. */
export function reset() {
  inbox.length = 0;
  outbox.length = 0;
}

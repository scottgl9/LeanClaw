import { describe, it, expect } from 'vitest';
import { escapeXml, formatMessages, formatOutbound, stripInternalTags, formatLocalTime } from './router.js';

describe('escapeXml', () => {
  it('escapes XML special characters', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('returns empty string for falsy input', () => {
    expect(escapeXml('')).toBe('');
  });
});

describe('formatMessages', () => {
  it('formats messages into XML', () => {
    const result = formatMessages([
      { id: '1', chat_jid: 'c1', sender: 'u1', sender_name: 'Alice', content: 'Hello', timestamp: '2024-01-01T12:00:00Z' },
      { id: '2', chat_jid: 'c1', sender: 'u2', sender_name: 'Bob', content: 'Hi there', timestamp: '2024-01-01T12:01:00Z' },
    ], 'UTC');

    expect(result).toContain('<context timezone="UTC"');
    expect(result).toContain('<messages>');
    expect(result).toContain('sender="Alice"');
    expect(result).toContain('sender="Bob"');
    expect(result).toContain('Hello');
    expect(result).toContain('Hi there');
  });

  it('escapes message content', () => {
    const result = formatMessages([
      { id: '1', chat_jid: 'c1', sender: 'u1', sender_name: 'A<B', content: 'x & y', timestamp: '2024-01-01T12:00:00Z' },
    ], 'UTC');

    expect(result).toContain('sender="A&lt;B"');
    expect(result).toContain('x &amp; y');
  });
});

describe('stripInternalTags', () => {
  it('removes internal tags', () => {
    expect(stripInternalTags('Hello <internal>secret</internal> World')).toBe('Hello  World');
  });

  it('handles multiline internal tags', () => {
    expect(stripInternalTags('A <internal>\nline1\nline2\n</internal> B')).toBe('A  B');
  });

  it('returns text unchanged if no internal tags', () => {
    expect(stripInternalTags('Hello World')).toBe('Hello World');
  });
});

describe('formatOutbound', () => {
  it('strips internal tags from output', () => {
    expect(formatOutbound('Response <internal>reasoning</internal> text')).toBe('Response  text');
  });

  it('returns empty string for internal-only content', () => {
    expect(formatOutbound('<internal>only internal</internal>')).toBe('');
  });
});

describe('formatLocalTime', () => {
  it('formats UTC time', () => {
    const result = formatLocalTime('2024-06-15T14:30:00Z', 'UTC');
    expect(result).toContain('Jun');
    expect(result).toContain('2024');
    expect(result).toContain('2:30');
  });
});

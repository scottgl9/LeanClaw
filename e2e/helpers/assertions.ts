/**
 * Reusable assertions for OpenClaw protocol shapes.
 * Uses Vitest expect() internally.
 */
import { expect } from 'vitest';

/**
 * Validates all required hello-ok fields per OpenClaw Protocol v3 spec.
 */
export function assertHelloOkShape(payload: any): void {
  expect(payload).toBeDefined();
  expect(payload.type).toBe('hello-ok');
  expect(typeof payload.protocol).toBe('number');

  // server block
  expect(payload.server).toBeDefined();
  expect(typeof payload.server.version).toBe('string');
  expect(payload.server.version.length).toBeGreaterThan(0);
  expect(typeof payload.server.connId).toBe('string');
  expect(payload.server.connId.length).toBeGreaterThan(0);

  // features block
  expect(payload.features).toBeDefined();
  expect(Array.isArray(payload.features.methods)).toBe(true);
  expect(payload.features.methods.length).toBeGreaterThan(0);
  expect(Array.isArray(payload.features.events)).toBe(true);
  expect(payload.features.events.length).toBeGreaterThan(0);

  // snapshot block
  expect(payload.snapshot).toBeDefined();
  expect(Array.isArray(payload.snapshot.presence)).toBe(true);
  expect(typeof payload.snapshot.health).toBe('object');
  expect(payload.snapshot.stateVersion).toBeDefined();
  expect(typeof payload.snapshot.stateVersion.presence).toBe('number');
  expect(typeof payload.snapshot.stateVersion.health).toBe('number');
  expect(typeof payload.snapshot.uptimeMs).toBe('number');
  expect(payload.snapshot.uptimeMs).toBeGreaterThanOrEqual(0);
  expect(typeof payload.snapshot.authMode).toBe('string');

  // policy block
  expect(payload.policy).toBeDefined();
  expect(payload.policy.maxPayload).toBeGreaterThan(0);
  expect(payload.policy.maxBufferedBytes).toBeGreaterThan(0);
  expect(payload.policy.tickIntervalMs).toBeGreaterThan(0);
}

/**
 * Validates a request frame shape: {type:'req', id, method}.
 */
export function assertRequestFrame(frame: any): void {
  expect(frame).toBeDefined();
  expect(frame.type).toBe('req');
  expect(typeof frame.id).toBe('string');
  expect(frame.id.length).toBeGreaterThan(0);
  expect(typeof frame.method).toBe('string');
  expect(frame.method.length).toBeGreaterThan(0);
}

/**
 * Validates a response frame shape: {type:'res', id, ok, payload|error}.
 */
export function assertResponseFrame(frame: any): void {
  expect(frame).toBeDefined();
  expect(frame.type).toBe('res');
  expect(typeof frame.id).toBe('string');
  expect(typeof frame.ok).toBe('boolean');
  if (frame.ok) {
    // payload may be undefined for void responses
  } else {
    expect(frame.error).toBeDefined();
    expect(typeof frame.error.code).toBe('string');
    expect(typeof frame.error.message).toBe('string');
  }
}

/**
 * Validates an event frame shape: {type:'event', event, payload, seq}.
 */
export function assertEventFrame(frame: any): void {
  expect(frame).toBeDefined();
  expect(frame.type).toBe('event');
  expect(typeof frame.event).toBe('string');
  expect(frame.event.length).toBeGreaterThan(0);
  // payload and seq are optional per schema
}

/**
 * Validates an error shape: {code, message}.
 */
export function assertErrorShape(error: any): void {
  expect(error).toBeDefined();
  expect(typeof error.code).toBe('string');
  expect(error.code.length).toBeGreaterThan(0);
  expect(typeof error.message).toBe('string');
  expect(error.message.length).toBeGreaterThan(0);
}

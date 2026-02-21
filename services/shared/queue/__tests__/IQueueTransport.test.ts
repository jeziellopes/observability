import { safeParseMessage, injectTraceContext, QueueMessage } from '../IQueueTransport';

const validPayload: QueueMessage = {
  type: 'order_created',
  orderId: 42,
  userId: 7,
  userName: 'Alice',
  total: 99.99,
  timestamp: '2026-02-21T10:00:00.000Z',
};

describe('safeParseMessage', () => {
  it('parses a valid message', () => {
    const result = safeParseMessage(JSON.stringify(validPayload));
    expect(result).toEqual(validPayload);
  });

  it('parses a valid message with traceContext', () => {
    const withCtx = { ...validPayload, traceContext: { traceparent: '00-abc-def-01' } };
    const result = safeParseMessage(JSON.stringify(withCtx));
    expect(result).toEqual(withCtx);
  });

  it('returns null for malformed JSON', () => {
    expect(safeParseMessage('not-json')).toBeNull();
    expect(safeParseMessage('{incomplete')).toBeNull();
    expect(safeParseMessage('')).toBeNull();
  });

  it('returns null for non-object JSON values', () => {
    expect(safeParseMessage('"string"')).toBeNull();
    expect(safeParseMessage('42')).toBeNull();
    expect(safeParseMessage('null')).toBeNull();
    expect(safeParseMessage('[]')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    const { type: _t, ...noType } = validPayload;
    expect(safeParseMessage(JSON.stringify(noType))).toBeNull();

    const { orderId: _o, ...noOrderId } = validPayload;
    expect(safeParseMessage(JSON.stringify(noOrderId))).toBeNull();

    const { userId: _u, ...noUserId } = validPayload;
    expect(safeParseMessage(JSON.stringify(noUserId))).toBeNull();

    const { total: _tot, ...noTotal } = validPayload;
    expect(safeParseMessage(JSON.stringify(noTotal))).toBeNull();
  });

  it('returns null when required fields have wrong types', () => {
    expect(safeParseMessage(JSON.stringify({ ...validPayload, orderId: 'not-a-number' }))).toBeNull();
    expect(safeParseMessage(JSON.stringify({ ...validPayload, total: '10.00' }))).toBeNull();
    expect(safeParseMessage(JSON.stringify({ ...validPayload, type: 123 }))).toBeNull();
  });

  it('returns null when traceContext contains non-string values', () => {
    const bad = { ...validPayload, traceContext: { traceparent: 42 } };
    expect(safeParseMessage(JSON.stringify(bad))).toBeNull();
  });

  it('returns null when traceContext is not an object', () => {
    const bad = { ...validPayload, traceContext: 'not-an-object' };
    expect(safeParseMessage(JSON.stringify(bad))).toBeNull();
  });

  it('handles extra unknown fields gracefully', () => {
    const extra = { ...validPayload, unknownField: 'value', nested: { x: 1 } };
    const result = safeParseMessage(JSON.stringify(extra));
    expect(result).not.toBeNull();
    expect(result?.type).toBe('order_created');
  });
});

describe('injectTraceContext', () => {
  it('adds a traceContext field to the message', () => {
    const result = injectTraceContext(validPayload);
    expect(result).toHaveProperty('traceContext');
    expect(typeof result.traceContext).toBe('object');
  });

  it('injects the W3C traceparent from the mock propagator', () => {
    const result = injectTraceContext(validPayload);
    expect(result.traceContext).toHaveProperty('traceparent');
  });

  it('does not mutate the original message', () => {
    const original = { ...validPayload };
    injectTraceContext(original);
    expect((original as QueueMessage).traceContext).toBeUndefined();
  });
});

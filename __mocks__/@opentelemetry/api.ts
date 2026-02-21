/**
 * Manual mock for @opentelemetry/api used in unit tests.
 * Provides minimal no-op implementations so shared utilities
 * can be tested without a running OTel SDK.
 */

const mockSpanContext = {
  traceId: 'aabbccddeeff00112233445566778899',
  spanId: '0011223344556677',
  traceFlags: 1,
};

const mockSpan = {
  spanContext: () => mockSpanContext,
};

export const trace = {
  getActiveSpan: jest.fn(() => null),
  _mockSpan: mockSpan,
};

export const context = {
  active: jest.fn(() => ({})),
};

export const propagation = {
  inject: jest.fn((ctx: unknown, carrier: Record<string, string>) => {
    // Simulate W3C traceparent injection
    carrier['traceparent'] = '00-aabbccddeeff00112233445566778899-0011223344556677-01';
  }),
};

export const isSpanContextValid = jest.fn(() => false);

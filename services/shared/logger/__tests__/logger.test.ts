import { trace, isSpanContextValid } from '@opentelemetry/api';

// Mock winston before importing the logger under test
const mockLog = jest.fn();
const mockChild = jest.fn(() => ({ log: mockLog }));
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({ child: mockChild })),
  format: {
    combine: jest.fn(() => ({})),
    timestamp: jest.fn(() => ({})),
    errors: jest.fn(() => ({})),
    json: jest.fn(() => ({})),
  },
  transports: { Console: jest.fn() },
}));

import { createLogger } from '../index';
import { describe, beforeEach, it } from 'node:test';

describe('createLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a child logger scoped to the service name', () => {
    createLogger('my-service');
    expect(mockChild).toHaveBeenCalledWith({ service: 'my-service' });
  });

  it('exposes info, warn, error, debug methods', () => {
    const logger = createLogger('svc');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('passes the message and meta to the underlying winston log call', () => {
    const logger = createLogger('svc');
    logger.info('hello world', { userId: 1 });
    expect(mockLog).toHaveBeenCalledWith('info', 'hello world', expect.objectContaining({ userId: 1 }));
  });

  it('adds empty traceId/spanId when there is no active span', () => {
    (trace.getActiveSpan as jest.Mock).mockReturnValue(null);
    const logger = createLogger('svc');
    logger.info('no span');
    expect(mockLog).toHaveBeenCalledWith('info', 'no span', expect.objectContaining({ traceId: '', spanId: '' }));
  });

  it('injects traceId and spanId from the active span when span context is valid', () => {
    const mockSpanCtx = { traceId: 'abc123', spanId: 'def456', traceFlags: 1 };
    (trace.getActiveSpan as jest.Mock).mockReturnValue({ spanContext: () => mockSpanCtx });
    (isSpanContextValid as jest.Mock).mockReturnValue(true);

    const logger = createLogger('svc');
    logger.warn('has span', { key: 'val' });

    expect(mockLog).toHaveBeenCalledWith('warn', 'has span', expect.objectContaining({
      traceId: 'abc123',
      spanId: 'def456',
      key: 'val',
    }));
  });

  it('falls back to empty strings when span context is invalid', () => {
    (trace.getActiveSpan as jest.Mock).mockReturnValue({ spanContext: () => ({ traceId: '', spanId: '' }) });
    (isSpanContextValid as jest.Mock).mockReturnValue(false);

    const logger = createLogger('svc');
    logger.error('bad span');
    expect(mockLog).toHaveBeenCalledWith('error', 'bad span', expect.objectContaining({ traceId: '', spanId: '' }));
  });
});

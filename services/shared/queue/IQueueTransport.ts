import { context, propagation } from '@opentelemetry/api';

export interface QueueMessage {
  type: string;
  orderId: number;
  userId: number;
  userName: string;
  total: number;
  timestamp: string;
  traceContext?: Record<string, string>;
}

/**
 * Common interface for queue transports.
 * Implementations: RedisTransport (local dev), SQSTransport (AWS production).
 *
 * Trace context propagation is always the caller's responsibility —
 * inject before publish, extract before consume. Neither transport
 * handles it automatically (Redis has no OTel support; SQS would via
 * AWS Distro for OTel, but we keep it explicit here for consistency).
 */
export interface IQueueTransport {
  publish(message: QueueMessage): Promise<void>;
  consume(handler: (message: QueueMessage) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

/** Inject current trace context into the message before publishing. */
export function injectTraceContext(message: Omit<QueueMessage, 'traceContext'>): QueueMessage {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return { ...message, traceContext: carrier };
}

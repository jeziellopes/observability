import { IQueueTransport } from './IQueueTransport';
import { RedisTransport } from './RedisTransport';
import { SQSTransport } from './SQSTransport';

export { IQueueTransport, QueueMessage, injectTraceContext } from './IQueueTransport';
export { RedisTransport } from './RedisTransport';
export { SQSTransport } from './SQSTransport';

type TransportType = 'redis' | 'sqs';

/**
 * Returns the queue transport selected by the QUEUE_TRANSPORT env var.
 *
 * QUEUE_TRANSPORT=redis  → RedisTransport  (default, local dev)
 * QUEUE_TRANSPORT=sqs    → SQSTransport    (AWS production)
 */
export async function createQueueTransport(): Promise<IQueueTransport> {
  const type = (process.env.QUEUE_TRANSPORT || 'redis') as TransportType;

  switch (type) {
    case 'sqs': {
      console.log('[Queue] using SQS transport');
      return new SQSTransport();
    }
    case 'redis':
    default: {
      console.log('[Queue] using Redis transport');
      const transport = new RedisTransport();
      await (transport as RedisTransport).connect();
      return transport;
    }
  }
}

import { createClient, RedisClientType } from 'redis';
import { IQueueTransport, QueueMessage } from './IQueueTransport';

const QUEUE_NAME = 'notifications';

export class RedisTransport implements IQueueTransport {
  private client: RedisClientType;
  private running = false;

  constructor() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379');

    this.client = createClient({ socket: { host, port } });
    this.client.on('error', (err: Error) => console.error('[RedisTransport] error:', err));
    this.client.on('connect', () => console.log(`[RedisTransport] connected to ${host}:${port}`));
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async publish(message: QueueMessage): Promise<void> {
    await this.client.lPush(QUEUE_NAME, JSON.stringify(message));
  }

  async consume(handler: (message: QueueMessage) => Promise<void>): Promise<void> {
    this.running = true;
    console.log('[RedisTransport] starting consumer...');

    while (this.running) {
      try {
        const result = await this.client.brPop(QUEUE_NAME, 1);
        if (result) {
          const message: QueueMessage = JSON.parse(result.element);
          await handler(message);
        }
      } catch (err) {
        console.error('[RedisTransport] consume error:', err);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async close(): Promise<void> {
    this.running = false;
    await this.client.quit();
  }
}

import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { IQueueTransport, QueueMessage } from './IQueueTransport';

/**
 * SQS transport for AWS production deployments.
 *
 * With AWS Distro for OpenTelemetry, SQS propagates trace context
 * automatically via message attributes. We still embed traceContext
 * in the JSON body here for consistency with the Redis transport —
 * so both consumers use the same extraction logic.
 */
export class SQSTransport implements IQueueTransport {
  private client: SQSClient;
  private queueUrl: string;
  private running = false;

  constructor() {
    const region = process.env.AWS_REGION || 'us-east-1';
    const endpoint = process.env.SQS_ENDPOINT; // allows LocalStack override

    this.client = new SQSClient({ region, ...(endpoint ? { endpoint } : {}) });
    this.queueUrl = process.env.SQS_QUEUE_URL || '';

    if (!this.queueUrl) {
      throw new Error('[SQSTransport] SQS_QUEUE_URL environment variable is required');
    }

    console.log(`[SQSTransport] queue: ${this.queueUrl}`);
  }

  async publish(message: QueueMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
      })
    );
  }

  async consume(handler: (message: QueueMessage) => Promise<void>): Promise<void> {
    this.running = true;
    console.log('[SQSTransport] starting consumer...');

    while (this.running) {
      try {
        const response = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 5, // long polling
          })
        );

        for (const sqsMessage of response.Messages || []) {
          try {
            const message: QueueMessage = JSON.parse(sqsMessage.Body!);
            await handler(message);

            await this.client.send(
              new DeleteMessageCommand({
                QueueUrl: this.queueUrl,
                ReceiptHandle: sqsMessage.ReceiptHandle!,
              })
            );
          } catch (err) {
            console.error('[SQSTransport] failed to process message:', err);
            // Message stays in queue and becomes visible again after visibility timeout
          }
        }
      } catch (err) {
        console.error('[SQSTransport] receive error:', err);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  async close(): Promise<void> {
    this.running = false;
    this.client.destroy();
  }
}

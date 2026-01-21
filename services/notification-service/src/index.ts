/**
 * Notification Service
 * Consumes messages from Redis queue and processes notifications
 * Demonstrates async processing with distributed tracing
 */

// Initialize OpenTelemetry BEFORE importing other modules
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'notification-service',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://jaeger:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Now import application modules
import express, { Request, Response } from 'express';
import { createClient, RedisClientType } from 'redis';
import { trace, context, propagation, SpanStatusCode, ROOT_CONTEXT } from '@opentelemetry/api';

interface Notification {
  type: string;
  orderId: number;
  userId: number;
  userName: string;
  total: number;
  timestamp: string;
  traceContext?: Record<string, string>;
}

const app = express();
const PORT = process.env.PORT || 3003;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

app.use(express.json());

// Redis client
let redisClient: RedisClientType;
let isProcessing = false;

async function initRedis() {
  redisClient = createClient({
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT
    }
  });

  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  redisClient.on('connect', () => console.log('Connected to Redis'));

  try {
    await redisClient.connect();
    console.log('Redis connection established');
    
    // Start processing queue
    processQueue();
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  }
}

// Process notifications from queue
async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  console.log('Starting queue processor...');

  while (isProcessing) {
    try {
      // Block and wait for new messages (BRPOP with 1 second timeout)
      const result = await redisClient.brPop('notifications', 1);

      if (result) {
        const message = result.element;
        await processNotification(message);
      }
    } catch (error) {
      console.error('Error processing queue:', error);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retrying
    }
  }
}

async function processNotification(message: string) {
  const tracer = trace.getTracer('notification-service');
  
  try {
    const notification: Notification = JSON.parse(message);
    
    // Extract trace context from message
    const extractedContext = notification.traceContext 
      ? propagation.extract(ROOT_CONTEXT, notification.traceContext)
      : ROOT_CONTEXT;

    // Start a new span linked to the parent trace
    await context.with(extractedContext, async () => {
      const span = tracer.startSpan('process-notification');
      
      span.setAttribute('notification.type', notification.type);
      span.setAttribute('notification.orderId', notification.orderId);
      span.setAttribute('notification.userId', notification.userId);
      
      console.log(`Processing notification: ${notification.type}`);
      console.log(`Order ID: ${notification.orderId}, User: ${notification.userName}, Total: $${notification.total}`);
      
      span.addEvent('Notification received from queue');
      
      // Simulate notification processing (email, SMS, push, etc.)
      await simulateNotificationSending(notification, span);
      
      span.addEvent('Notification processed successfully');
      span.end();
    });
  } catch (error) {
    console.error('Error processing notification:', error);
    const span = tracer.startSpan('process-notification-error');
    span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
    span.recordException(error as Error);
    span.end();
  }
}

async function simulateNotificationSending(notification: Notification, span: any) {
  const tracer = trace.getTracer('notification-service');
  
  return new Promise((resolve) => {
    const sendSpan = tracer.startSpan('send-notification', { parent: span });
    
    sendSpan.setAttribute('notification.channel', 'email');
    sendSpan.addEvent('Sending email notification');
    
    // Simulate email sending delay
    setTimeout(() => {
      console.log(`✉️  Email sent to user ${notification.userName} for order ${notification.orderId}`);
      sendSpan.addEvent('Email sent successfully');
      sendSpan.end();
      resolve(true);
    }, 100);
  });
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    service: 'notification-service',
    queueActive: isProcessing 
  });
});

// Get service stats
app.get('/stats', (req: Request, res: Response) => {
  res.json({
    service: 'notification-service',
    queueActive: isProcessing,
    redis: {
      host: REDIS_HOST,
      port: REDIS_PORT,
      connected: redisClient?.isOpen || false
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Notification Service listening on port ${PORT}`);
  console.log(`Redis: ${REDIS_HOST}:${REDIS_PORT}`);
});

// Initialize Redis and start processing
initRedis();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  isProcessing = false;
  
  if (redisClient) {
    await redisClient.quit();
  }
  
  sdk.shutdown()
    .then(() => {
      console.log('OpenTelemetry terminated');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error during shutdown', error);
      process.exit(1);
    });
});

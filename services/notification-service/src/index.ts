/**
 * Notification Service
 * Consumes messages from the queue transport and processes notifications
 * Demonstrates async processing with distributed tracing
 */

// Initialize OpenTelemetry BEFORE importing other modules
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const prometheusExporter = new PrometheusExporter({ preventServerStart: true });

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'notification-service',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://jaeger:4318/v1/traces',
  }),
  metricReader: prometheusExporter,
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Now import application modules
import express, { Request, Response } from 'express';
import { trace, context, propagation, SpanStatusCode, ROOT_CONTEXT, metrics } from '@opentelemetry/api';
import { createQueueTransport, QueueMessage, IQueueTransport } from '../../shared/queue';
import { createLogger } from '../../shared/logger';

const logger = createLogger('notification-service');

// --- Business metrics ---
const meter = metrics.getMeter('notification-service');
const notificationsSent = meter.createCounter('notifications_sent_total', {
  description: 'Total notifications successfully processed and sent',
});
const notificationsFailed = meter.createCounter('notifications_failed_total', {
  description: 'Total notifications that failed during processing',
});
const processingDuration = meter.createHistogram('notification_processing_duration_ms', {
  description: 'Time taken to process and send a notification',
  unit: 'ms',
  boundaries: [10, 25, 50, 100, 250, 500, 1000],
});

type Notification = QueueMessage;

const app = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());

let queue: IQueueTransport | null = null;

// Initialize transport and start consuming
createQueueTransport().then((t: IQueueTransport) => {
  queue = t;
  queue.consume(processNotification).catch((err: unknown) =>
    console.error('Queue consumer error:', err)
  );
}).catch((err: unknown) => console.error('Failed to initialize queue transport:', err));

async function processNotification(notification: Notification) {
    
  const tracer = trace.getTracer('notification-service');
  const startTime = Date.now();

  try {
    const extractedContext = notification.traceContext
      ? propagation.extract(ROOT_CONTEXT, notification.traceContext)
      : ROOT_CONTEXT;

    // Extract trace context from message
    await context.with(extractedContext, async () => {
      const span = tracer.startSpan('process-notification');
      
      span.setAttribute('notification.type', notification.type);
      span.setAttribute('notification.orderId', notification.orderId);
      span.setAttribute('notification.userId', notification.userId);
      
      logger.info('Processing notification', {
        type: notification.type,
        orderId: notification.orderId,
        userId: notification.userId,
      });
      
      span.addEvent('Notification received from queue');
      
      // Simulate notification processing (email, SMS, push, etc.)
      await simulateNotificationSending(notification, span);
      
      const durationMs = Date.now() - startTime;
      processingDuration.record(durationMs, { type: notification.type });
      notificationsSent.add(1, { type: notification.type });
      
      span.addEvent('Notification processed successfully');
      span.end();
    });
  } catch (error) {
    notificationsFailed.add(1);
    logger.error('Error processing notification', { error: (error as Error).message });
    const span = tracer.startSpan('process-notification-error');
    span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
    span.recordException(error as Error);
    span.end();
  }
}

async function simulateNotificationSending(notification: Notification, span: any) {
  const tracer = trace.getTracer('notification-service');
  
  return new Promise((resolve) => {
    const ctx = trace.setSpan(context.active(), span);
    const sendSpan = tracer.startSpan('send-notification', {}, ctx);
    
    sendSpan.setAttribute('notification.channel', 'email');
    sendSpan.addEvent('Sending email notification');
    
    // Simulate email sending delay
    setTimeout(() => {
      logger.info('Email sent', { userId: notification.userName, orderId: notification.orderId });
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
    queueActive: queue !== null,
  });
});

// Prometheus metrics endpoint
app.get('/metrics', (req: Request, res: Response) => {
  prometheusExporter.getMetricsRequestHandler(req as any, res as any);
});

// Get service stats
app.get('/stats', (req: Request, res: Response) => {
  res.json({
    service: 'notification-service',
    queueActive: queue !== null,
    transport: process.env.QUEUE_TRANSPORT || 'redis',
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Notification Service listening on port ${PORT}`, {
    queueTransport: process.env.QUEUE_TRANSPORT || 'redis',
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');

  if (queue) {
    await queue.close();
  }

  sdk.shutdown()
    .then(() => {
      logger.info('OpenTelemetry terminated');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Error during shutdown', { error: (error as Error).message });
      process.exit(1);
    });
});

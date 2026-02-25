/**
 * Order Service
 * Manages orders with user validation and async notifications
 * Demonstrates inter-service communication and queue integration
 */

// Initialize OpenTelemetry BEFORE importing other modules
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const prometheusExporter = new PrometheusExporter({ preventServerStart: true });

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'order-service',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://jaeger:4318/v1/traces',
  }),
  metricReader: prometheusExporter,
  instrumentations: [getNodeAutoInstrumentations(), new RuntimeNodeInstrumentation()],
});

sdk.start();

// Now import application modules
import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import { createQueueTransport, injectTraceContext, IQueueTransport } from '../../shared/queue';
import { createLogger } from '../../shared/logger';

const logger = createLogger('order-service');

// --- Business metrics ---
const meter = metrics.getMeter('order-service');
const ordersCreated = meter.createCounter('orders_created_total', {
  description: 'Total number of orders created',
});
const ordersErrors = meter.createCounter('orders_errors_total', {
  description: 'Total number of order creation errors',
});
const orderValue = meter.createHistogram('order_value', {
  description: 'Distribution of order values in USD',
  unit: 'USD',
});

interface Order {
  id: number;
  userId: number;
  items: string[];
  total: number;
  status: string;
  createdAt: Date;
  updatedAt?: Date;
}

const app = express();
const PORT = process.env.PORT || 3002;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';

app.use(express.json());

// Prometheus metrics endpoint
app.get('/metrics', (req: Request, res: Response) => {
  prometheusExporter.getMetricsRequestHandler(req as any, res as any);
});

let queue: IQueueTransport;

createQueueTransport()
  .then((t: IQueueTransport) => { queue = t; })
  .catch((err: unknown) => console.error('Failed to initialize queue transport:', err));

// In-memory order store (mock database)
const orders = new Map<number, Order>([
  [1, { id: 1, userId: 1, items: ['Widget A', 'Widget B'], total: 150.00, status: 'completed', createdAt: new Date('2024-01-20') }],
  [2, { id: 2, userId: 2, items: ['Gadget X'], total: 299.99, status: 'pending', createdAt: new Date('2024-02-15') }],
]);
let nextOrderId = 3;

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'order-service' });
});

// Get all orders
app.get('/orders', (req: Request, res: Response) => {
  const tracer = trace.getTracer('order-service');
  const span = tracer.startSpan('get-all-orders');
  
  span.setAttribute('order.count', orders.size);
  span.addEvent('Fetching all orders from database');
  
  setTimeout(() => {
    const orderList = Array.from(orders.values());
    span.addEvent('Orders retrieved successfully', { count: orderList.length });
    span.end();
    res.json({ orders: orderList, count: orderList.length });
  }, 40);
});

// Get order by ID
app.get('/orders/:id', async (req: Request, res: Response) => {
  const tracer = trace.getTracer('order-service');
  const span = tracer.startSpan('get-order-by-id');
  
  const orderId = parseInt(req.params.id);
  span.setAttribute('order.id', orderId);
  
  try {
    const order = orders.get(orderId);
    
    if (!order) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Order not found' });
      span.setAttribute('error', true);
      span.end();
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Fetch user details for the order
    span.addEvent('Fetching user details');
    const userResponse = await axios.get(`${USER_SERVICE_URL}/users/${order.userId}`);
    
    const enrichedOrder = {
      ...order,
      user: userResponse.data
    };
    
    span.addEvent('Order retrieved with user details');
    span.end();
    res.json(enrichedOrder);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    span.end();
    console.error('Error fetching order:', errorMessage);
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
});

// Create new order
app.post('/orders', async (req: Request, res: Response) => {
  const tracer = trace.getTracer('order-service');
  const span = tracer.startSpan('create-order');
  
  const { userId, items, total } = req.body;
  
  // Validation
  if (!userId || !items || !total || typeof total !== 'number') {
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Missing required fields' });
    span.setAttribute('error', true);
    span.end();
    ordersErrors.add(1, { reason: 'validation_error' });
    return res.status(400).json({ error: 'userId, items, and total are required' });
  }
  
  span.setAttribute('order.userId', userId);
  span.setAttribute('order.itemCount', items.length);
  span.setAttribute('order.total', total);
  
  try {
    // Validate user exists
    span.addEvent('Validating user exists');
    const userResponse = await axios.get(`${USER_SERVICE_URL}/users/${userId}`);
    const user = userResponse.data;
    
    span.addEvent('User validated', { userName: user.name });
    
    // Create order
    span.addEvent('Creating order in database');
    const newOrder = {
      id: nextOrderId++,
      userId,
      items,
      total,
      status: 'pending',
      createdAt: new Date()
    };
    
    orders.set(newOrder.id, newOrder);
    ordersCreated.add(1, { status: 'success' });
    orderValue.record(total);
    
    span.setAttribute('order.id', newOrder.id);
    span.addEvent('Order created successfully');
    
    // Publish notification to queue
    if (queue) {
      span.addEvent('Publishing notification to queue');

      const notification = injectTraceContext({
        type: 'order_created',
        orderId: newOrder.id,
        userId: userId,
        userName: user.name,
        total: total,
        timestamp: new Date().toISOString(),
      });

      await queue.publish(notification);
      span.addEvent('Notification published to queue');
    }
    
    span.end();
    logger.info('Order created', { orderId: newOrder.id, userId, total });
    res.status(201).json(newOrder);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    span.end();
    ordersErrors.add(1, { reason: 'internal_error' });
    
    logger.error('Error creating order', { error: errorMessage });
    
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as any;
      if (axiosError.response?.status === 404) {
        return res.status(404).json({ error: 'User not found' });
      }
    }
    
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Update order status
app.patch('/orders/:id/status', (req: Request, res: Response) => {
  const tracer = trace.getTracer('order-service');
  const span = tracer.startSpan('update-order-status');
  
  const orderId = parseInt(req.params.id);
  const { status } = req.body;
  
  span.setAttribute('order.id', orderId);
  span.setAttribute('order.newStatus', status);
  
  const order = orders.get(orderId);
  
  if (!order) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Order not found' });
    span.setAttribute('error', true);
    span.end();
    return res.status(404).json({ error: 'Order not found' });
  }
  
  order.status = status;
  order.updatedAt = new Date();
  
  span.addEvent('Order status updated');
  span.end();
  
  res.json(order);
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Order Service listening on port ${PORT}`, {
    userServiceUrl: USER_SERVICE_URL,
    queueTransport: process.env.QUEUE_TRANSPORT || 'redis',
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');

  if (queue) {
    await queue.close();
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

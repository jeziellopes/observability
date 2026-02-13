/**
 * API Gateway Service
 * Entry point for all client requests
 * Routes to downstream microservices with distributed tracing
 */

// Initialize OpenTelemetry BEFORE importing other modules
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'api-gateway',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://jaeger:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Now import application modules
import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { trace } from '@opentelemetry/api';

const app = express();
const PORT = process.env.PORT || 3000;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:3002';

app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'api-gateway' });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  const tracer = trace.getTracer('api-gateway');
  const span = tracer.startSpan('root-request');
  
  span.addEvent('Processing root request');
  span.setAttribute('http.method', 'GET');
  span.setAttribute('http.route', '/');
  
  res.json({
    service: 'API Gateway',
    version: '1.0.0',
    endpoints: {
      users: '/api/users',
      orders: '/api/orders',
      health: '/health'
    }
  });
  
  span.end();
});

// User Service Routes
app.get('/api/users', async (req: Request, res: Response) => {
  try {
    const response = await axios.get(`${USER_SERVICE_URL}/users`);
    res.json(response.data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error calling user service:', errorMessage);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const response = await axios.get(`${USER_SERVICE_URL}/users/${req.params.id}`);
    res.json(response.data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error calling user service:', errorMessage);
    const axiosError = error as any;
    res.status(axiosError.response?.status || 500).json({ 
      error: axiosError.response?.data?.error || 'Failed to fetch user' 
    });
  }
});

app.post('/api/users', async (req: Request, res: Response) => {
  try {
    const response = await axios.post(`${USER_SERVICE_URL}/users`, req.body);
    res.status(201).json(response.data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error calling user service:', errorMessage);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Order Service Routes
app.get('/api/orders', async (req: Request, res: Response) => {
  try {
    const response = await axios.get(`${ORDER_SERVICE_URL}/orders`);
    res.json(response.data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error calling order service:', errorMessage);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.get('/api/orders/:id', async (req: Request, res: Response) => {
  try {
    const response = await axios.get(`${ORDER_SERVICE_URL}/orders/${req.params.id}`);
    res.json(response.data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error calling order service:', errorMessage);
    const axiosError = error as any;
    res.status(axiosError.response?.status || 500).json({ 
      error: axiosError.response?.data?.error || 'Failed to fetch order' 
    });
  }
});

app.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const response = await axios.post(`${ORDER_SERVICE_URL}/orders`, req.body);
    res.status(201).json(response.data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error calling order service:', errorMessage);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`API Gateway listening on port ${PORT}`);
  console.log(`User Service URL: ${USER_SERVICE_URL}`);
  console.log(`Order Service URL: ${ORDER_SERVICE_URL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
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

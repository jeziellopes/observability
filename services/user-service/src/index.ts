/**
 * User Service
 * Manages user data with CRUD operations
 * Includes OpenTelemetry instrumentation for distributed tracing
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
    [SemanticResourceAttributes.SERVICE_NAME]: 'user-service',
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
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import { createLogger } from '../../shared/logger';

const logger = createLogger('user-service');

// --- Business metrics ---
const meter = metrics.getMeter('user-service');
const usersCreated = meter.createCounter('users_created_total', {
  description: 'Total number of users created',
});
const userErrors = meter.createCounter('users_errors_total', {
  description: 'Total number of user operation errors',
});

interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt?: Date;
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Prometheus metrics endpoint
app.get('/metrics', (req: Request, res: Response) => {
  prometheusExporter.getMetricsRequestHandler(req as any, res as any);
});

// In-memory user store (mock database)
const users = new Map<number, User>([
  [1, { id: 1, name: 'Alice Johnson', email: 'alice@example.com', createdAt: new Date('2024-01-15') }],
  [2, { id: 2, name: 'Bob Smith', email: 'bob@example.com', createdAt: new Date('2024-02-20') }],
  [3, { id: 3, name: 'Carol White', email: 'carol@example.com', createdAt: new Date('2024-03-10') }],
]);
let nextUserId = 4;

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'user-service' });
});

// Get all users
app.get('/users', (req: Request, res: Response) => {
  const tracer = trace.getTracer('user-service');
  const span = tracer.startSpan('get-all-users');
  
  span.setAttribute('user.count', users.size);
  span.addEvent('Fetching all users from database');
  
  // Simulate database query delay
  setTimeout(() => {
    const userList = Array.from(users.values());
    span.addEvent('Users retrieved successfully', { count: userList.length });
    span.end();
    res.json({ users: userList, count: userList.length });
  }, 50);
});

// Get user by ID
app.get('/users/:id', (req: Request, res: Response) => {
  const tracer = trace.getTracer('user-service');
  const span = tracer.startSpan('get-user-by-id');
  
  const userId = parseInt(req.params.id);
  span.setAttribute('user.id', userId);
  span.addEvent('Looking up user in database');
  
  // Simulate database query delay
  setTimeout(() => {
    const user = users.get(userId);
    
    if (!user) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'User not found' });
      span.setAttribute('error', true);
      span.addEvent('User not found', { userId });
      span.end();
      return res.status(404).json({ error: 'User not found' });
    }
    
    span.addEvent('User retrieved successfully');
    span.setAttribute('user.name', user.name);
    span.end();
    res.json(user);
  }, 30);
});

// Create new user
app.post('/users', (req: Request, res: Response) => {
  const tracer = trace.getTracer('user-service');
  const span = tracer.startSpan('create-user');
  
  const { name, email } = req.body;
  
  // Validation
  if (!name || !email) {
    userErrors.add(1, { reason: 'validation' });
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Missing required fields' });
    span.setAttribute('error', true);
    span.addEvent('Validation failed', { name: !!name, email: !!email });
    span.end();
    return res.status(400).json({ error: 'Name and email are required' });
  }
  
  span.setAttribute('user.name', name);
  span.setAttribute('user.email', email);
  span.addEvent('Creating new user in database');
  
  // Simulate database insert delay
  setTimeout(() => {
    const newUser = {
      id: nextUserId++,
      name,
      email,
      createdAt: new Date()
    };
    
    users.set(newUser.id, newUser);
    usersCreated.add(1);
    
    span.setAttribute('user.id', newUser.id);
    span.addEvent('User created successfully', { userId: newUser.id });
    span.end();
    
    logger.info('User created', { userId: newUser.id, name: newUser.name });
    res.status(201).json(newUser);
  }, 80);
});

// Update user
app.put('/users/:id', (req: Request, res: Response) => {
  const tracer = trace.getTracer('user-service');
  const span = tracer.startSpan('update-user');
  
  const userId = parseInt(req.params.id);
  const { name, email } = req.body;
  
  span.setAttribute('user.id', userId);
  
  const user = users.get(userId);
  
  if (!user) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'User not found' });
    span.setAttribute('error', true);
    span.end();
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Update user
  if (name) user.name = name;
  if (email) user.email = email;
  user.updatedAt = new Date();
  
  span.addEvent('User updated successfully');
  span.end();
  
  res.json(user);
});

// Delete user
app.delete('/users/:id', (req: Request, res: Response) => {
  const tracer = trace.getTracer('user-service');
  const span = tracer.startSpan('delete-user');
  
  const userId = parseInt(req.params.id);
  span.setAttribute('user.id', userId);
  
  const deleted = users.delete(userId);
  
  if (!deleted) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'User not found' });
    span.setAttribute('error', true);
    span.end();
    return res.status(404).json({ error: 'User not found' });
  }
  
  span.addEvent('User deleted successfully');
  span.end();
  
  res.status(204).send();
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  logger.info(`User Service listening on port ${PORT}`, { initialUsers: users.size });
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

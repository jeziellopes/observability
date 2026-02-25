/**
 * AWS Lambda Function - Order Validator
 * Validates order data with OpenTelemetry tracing
 * Demonstrates serverless observability
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { AwsLambdaInstrumentation } from '@opentelemetry/instrumentation-aws-lambda';
import { trace, SpanStatusCode } from '@opentelemetry/api';

// Initialize OpenTelemetry SDK
const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'order-validator-lambda',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    [SemanticResourceAttributes.CLOUD_PROVIDER]: 'aws',
    [SemanticResourceAttributes.FAAS_NAME]: process.env.AWS_LAMBDA_FUNCTION_NAME || 'order-validator',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://jaeger:4318/v1/traces',
  }),
  instrumentations: [
    getNodeAutoInstrumentations(),
    new AwsLambdaInstrumentation(),
  ],
});

sdk.start();

interface OrderValidationRequest {
  userId: number;
  items: string[];
  total: number;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate order data
 */
function validateOrder(order: OrderValidationRequest): ValidationResult {
  const tracer = trace.getTracer('order-validator-lambda');
  const span = tracer.startSpan('validate-order-logic');
  
  const errors: string[] = [];
  const warnings: string[] = [];

  span.setAttribute('order.userId', order.userId);
  span.setAttribute('order.itemCount', order.items?.length || 0);
  span.setAttribute('order.total', order.total);

  // Validate userId
  if (!order.userId || order.userId <= 0) {
    errors.push('Invalid userId: must be a positive number');
    span.addEvent('Validation failed: invalid userId');
  }

  // Validate items
  if (!order.items || !Array.isArray(order.items)) {
    errors.push('Invalid items: must be an array');
    span.addEvent('Validation failed: items not an array');
  } else if (order.items.length === 0) {
    errors.push('Invalid items: must contain at least one item');
    span.addEvent('Validation failed: empty items array');
  } else if (order.items.length > 50) {
    warnings.push('Large order: more than 50 items may require special handling');
    span.addEvent('Warning: large order detected', { itemCount: order.items.length });
  }

  // Validate total
  if (typeof order.total !== 'number' || order.total < 0) {
    errors.push('Invalid total: must be a non-negative number');
    span.addEvent('Validation failed: invalid total');
  } else if (order.total === 0) {
    warnings.push('Order total is zero');
    span.addEvent('Warning: zero total order');
  } else if (order.total > 10000) {
    warnings.push('High-value order: total exceeds $10,000');
    span.addEvent('Warning: high-value order', { total: order.total });
  }

  const isValid = errors.length === 0;
  span.setAttribute('validation.result', isValid);
  span.setAttribute('validation.errorCount', errors.length);
  span.setAttribute('validation.warningCount', warnings.length);

  if (!isValid) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Validation failed' });
  }

  span.end();

  return {
    valid: isValid,
    errors,
    warnings,
  };
}

/**
 * Lambda handler function
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const tracer = trace.getTracer('order-validator-lambda');
  const span = tracer.startSpan('lambda-handler');

  span.setAttribute('faas.execution', context.awsRequestId);
  span.setAttribute('http.method', event.httpMethod);
  span.setAttribute('http.path', event.path);

  console.log('Order validation Lambda invoked');
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Parse request body
    let orderData: OrderValidationRequest;
    
    if (!event.body) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Missing request body' });
      span.end();
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Request body is required',
        }),
      };
    }

    try {
      orderData = JSON.parse(event.body);
    } catch (parseError) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid JSON' });
      span.recordException(parseError as Error);
      span.end();
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Invalid JSON in request body',
        }),
      };
    }

    // Validate the order
    span.addEvent('Starting order validation');
    const validationResult = validateOrder(orderData);
    span.addEvent('Order validation completed', {
      valid: validationResult.valid,
      errorCount: validationResult.errors.length,
    });

    // Determine response status code
    const statusCode = validationResult.valid ? 200 : 400;
    span.setAttribute('http.status_code', statusCode);

    span.end();

    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        ...validationResult,
        timestamp: new Date().toISOString(),
        requestId: context.awsRequestId,
      }),
    };
  } catch (error) {
    console.error('Error processing request:', error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
    span.recordException(error as Error);
    span.end();

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: (error as Error).message,
      }),
    };
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  await sdk.shutdown();
});

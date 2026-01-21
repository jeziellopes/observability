# Lambda Function - Order Validator

## Overview
This Lambda function validates order data and demonstrates serverless observability with OpenTelemetry.

## Local Testing

### Build the function
```bash
npm install
npm run build
```

### Test with SAM CLI (if installed)
```bash
sam local invoke -e test-event.json
```

### Test with AWS CLI
```bash
aws lambda invoke \
  --function-name order-validator \
  --payload file://test-event.json \
  output.json
```

## Deployment

### Using Terraform
The Lambda function is deployed via Terraform in the infrastructure directory.

### Manual deployment
```bash
npm run build
aws lambda update-function-code \
  --function-name order-validator \
  --zip-file fileb://lambda.zip
```

## Environment Variables
- `OTEL_EXPORTER_OTLP_ENDPOINT`: OpenTelemetry collector endpoint
- `AWS_LAMBDA_FUNCTION_NAME`: Set automatically by AWS

## Sample Request
```json
{
  "userId": 1,
  "items": ["Product A", "Product B"],
  "total": 99.99
}
```

## Response
```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "timestamp": "2024-01-20T10:30:00.000Z",
  "requestId": "abc123"
}
```

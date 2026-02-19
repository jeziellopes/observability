# Observability Demo — Microservices with OpenTelemetry

A portfolio project demonstrating the three pillars of observability — **traces, metrics, and logs** — across a distributed microservices system on AWS.

Covers distributed tracing across HTTP services, async queue boundaries, and serverless functions using OpenTelemetry as the single instrumentation layer.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Tracing | OpenTelemetry + Jaeger |
| Metrics | Prometheus + Grafana *(in progress)* |
| Services | TypeScript + Express (×4) + AWS Lambda |
| Queue | AWS SQS (production) / Redis (local dev) |
| Infra | Terraform + ECS Fargate + Docker Compose |

---

## Architecture

```mermaid
graph TB
    Client([Client])
    APIGateway[API Gateway<br/>Port 3000]
    UserService[User Service<br/>Port 3001]
    OrderService[Order Service<br/>Port 3002]
    Lambda[Lambda Validator<br/>AWS Lambda]
    Queue[(Queue Transport<br/>Redis local / SQS on AWS)]
    NotificationService[Notification Service<br/>Port 3003]
    Jaeger[Jaeger UI<br/>Port 16686]

    Client -->|HTTP Request| APIGateway
    APIGateway -->|REST API| UserService
    APIGateway -->|REST API| OrderService
    APIGateway -->|Invoke| Lambda
    OrderService -->|Publish + traceContext| Queue
    Queue -->|Consume + extract traceContext| NotificationService

    UserService -.->|Traces| Jaeger
    OrderService -.->|Traces| Jaeger
    NotificationService -.->|Traces| Jaeger
    Lambda -.->|Traces| Jaeger
    APIGateway -.->|Traces| Jaeger

    style Client fill:#e1f5ff30
    style APIGateway fill:#bbdefb30
    style UserService fill:#c8e6c930
    style OrderService fill:#c8e6c930
    style NotificationService fill:#c8e6c930
    style Lambda fill:#fff9c430
    style Queue fill:#ffccbc30
    style Jaeger fill:#f8bbd030
```

---

## Trace Propagation

### HTTP (automatic)
OpenTelemetry auto-instrumentation injects `traceparent` headers into every outbound Axios request and extracts them on every incoming Express request. No manual code required.

### Async queue boundary (manual)
Queue transports have no native header mechanism. Trace context must be serialized into the message payload explicitly:

```typescript
// Order Service — inject before publishing
const carrier = {};
propagation.inject(context.active(), carrier);
await queue.publish({ ...data, traceContext: carrier });

// Notification Service — extract before processing
const ctx = propagation.extract(ROOT_CONTEXT, message.traceContext);
await context.with(ctx, async () => {
  const span = tracer.startSpan('process-notification');
  // span is a child of the original request trace
});
```

### Serverless
AWS Lambda invocations are traced via the same OTel SDK — spans appear as children of the API Gateway span in Jaeger.

---

## Pluggable Queue Transport

The queue is abstracted behind a common `IQueueTransport` interface. Transport is selected at runtime via environment variable:

```
QUEUE_TRANSPORT=redis   # local development (default)
QUEUE_TRANSPORT=sqs     # AWS production
```

| Transport | OTel propagation | Notes |
|-----------|-----------------|-------|
| SQS | Automatic via AWS Distro for OTel | Production — native to the AWS stack |
| Redis | Manual — serialized in payload | Local dev — no cloud credentials needed |
| Kafka | Automatic via `instrumentation-kafkajs` | High throughput, replay, consumer groups |
| RabbitMQ | Automatic via `instrumentation-amqplib` | Routing, exchanges, priorities |

`docker-compose.yml` sets `QUEUE_TRANSPORT=redis`. Terraform task definitions set `QUEUE_TRANSPORT=sqs` with the `SQS_QUEUE_URL` output.

---

## Trace Scenarios

| Scenario | Path | Propagation |
|----------|------|-------------|
| User lookup | API Gateway → User Service | Automatic (HTTP) |
| Order creation | API Gateway → Order Service → User Service | Automatic (HTTP) |
| Async notification | Order Service → Queue → Notification Service | Manual (payload) |
| Order validation | API Gateway → Lambda | Automatic (HTTP) |

---

## Quick Start

**Prerequisites**: Node.js 20+, Docker & Docker Compose

```bash
docker-compose up --build

# Create a user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "email": "john@example.com"}'

# Create an order — triggers full trace across all services
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"userId": 1, "items": ["Product A"], "total": 49.99}'

# View traces
open http://localhost:16686
```

Service ports: API Gateway `:3000` · User `:3001` · Order `:3002` · Notification `:3003` · Jaeger UI `:16686`

---

## Project Structure

```
observability/
├── services/
│   ├── api-gateway/          # Entry point, routes requests
│   ├── user-service/         # User CRUD
│   ├── order-service/        # Order processing + queue publish
│   └── notification-service/ # Queue consumer
├── services/shared/queue/    # IQueueTransport, RedisTransport, SQSTransport
├── lambda/                   # Order validator (AWS Lambda)
├── infrastructure/terraform/ # ECS, Lambda, SQS, networking
├── configs/                  # Shared OpenTelemetry config
└── docker-compose.yml
```

---

## API Reference

**Users**
```
GET  /api/users           list all users
GET  /api/users/:id       get user by ID
POST /api/users           create user — { name: string, email: string }
```

**Orders**
```
GET  /api/orders          list all orders
GET  /api/orders/:id      get order with user details
POST /api/orders          create order — { userId: number, items: string[], total: number }
```

---

## AWS Deployment

```bash
# Build and push images to ECR
export AWS_ACCOUNT_ID="your-account-id"
export AWS_REGION="us-east-1"
./infrastructure/scripts/build-and-push.sh

# Deploy
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init && terraform apply

# Outputs
terraform output api_gateway_url
terraform output sqs_queue_url
```

**Estimated cost**: ~$80–100/month (ECS Fargate + ALB + NAT Gateway). Teardown: `terraform destroy`.

---

## Development

```bash
# Run a single service locally
cd services/order-service && npm install && npm run dev

# Build Lambda package
cd lambda && npm install && npm run build  # → lambda.zip
```

---

## Demonstration

![Screen](./sample.png)

---

## Notes

- ⚠️ Demo project — no auth, HTTP only, no secret management
- Prometheus + Grafana dashboards in progress (see [PLAN_MONITORING.md](PLAN_MONITORING.md))

**Documentation**: [PLAN.md](PLAN.md) · [TASKS.md](TASKS.md) · [infrastructure/terraform/README.md](infrastructure/terraform/README.md) · [lambda/README.md](lambda/README.md)

---

**Built with**: OpenTelemetry · TypeScript · Express · Jaeger · Prometheus · Grafana · Redis · AWS SQS · ECS Fargate · Lambda · Terraform

**Contact**: [jeziellcarvalho@gmail.com](mailto:jeziellcarvalho@gmail.com) · [linkedin.com/in/jezielcarvalho](https://linkedin.com/in/jezielcarvalho)

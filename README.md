# Distributed O11y Lab — OTel, Prometheus, Loki, Alertmanager

![CI](https://github.com/jeziellopes/o11y-lab/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-instrumented-f5a800?logo=opentelemetry&logoColor=white)
![Terraform](https://img.shields.io/badge/Terraform-IaC-7B42BC?logo=terraform&logoColor=white)

I built this to get hands-on with the full o11y stack — not just traces or just metrics in isolation, but how the three pillars actually connect in a distributed system and where things break down.

The interesting parts were the async queue boundary (OTel has no native mechanism there, so trace context has to be serialized manually into the message payload), the SLO burn rate math in Prometheus, and getting Loki → Grafana → Jaeger linked so a log line's `traceId` takes you directly to the trace.

Runs locally with `docker-compose up`. Deploys to AWS ECS + Lambda via Terraform.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Tracing | OpenTelemetry + Jaeger |
| Metrics | Prometheus + Grafana |
| Logs | Loki + Promtail + Winston (structured JSON) |
| Alerting | Alertmanager (severity routing, inhibition) |
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
    Prometheus[Prometheus<br/>Port 9090]
    Grafana[Grafana<br/>Port 3100]

    Client -->|HTTP Request| APIGateway
    APIGateway -->|REST API| UserService
    APIGateway -->|REST API| OrderService
    APIGateway -->|Invoke| Lambda
    OrderService -->|Publish + traceContext| Queue
    Queue -->|Consume + extract traceContext| NotificationService

    UserService -.->|Traces + Metrics| Jaeger
    OrderService -.->|Traces + Metrics| Jaeger
    NotificationService -.->|Traces + Metrics| Jaeger
    Lambda -.->|Traces| Jaeger
    APIGateway -.->|Traces + Metrics| Jaeger

    Prometheus -->|Scrape /metrics| APIGateway
    Prometheus -->|Scrape /metrics| UserService
    Prometheus -->|Scrape /metrics| OrderService
    Prometheus -->|Scrape /metrics| NotificationService
    Prometheus -->|Scrape metrics| Jaeger
    Grafana -->|Query| Prometheus

    style Client fill:#e1f5ff30
    style APIGateway fill:#bbdefb30
    style UserService fill:#c8e6c930
    style OrderService fill:#c8e6c930
    style NotificationService fill:#c8e6c930
    style Lambda fill:#fff9c430
    style Queue fill:#ffccbc30
    style Jaeger fill:#f8bbd030
    style Prometheus fill:#ffe0b230
    style Grafana fill:#e8f5e930
```

---

## Observability Pillars

### Traces (Jaeger)
Every HTTP hop and queue boundary is captured — including the async Redis/SQS message where I had to manually inject the W3C `traceparent` into the payload. Open `http://localhost:16686` and search for `order-service` to see the full cross-service trace.

### Metrics (Prometheus + Grafana)
Services expose `/metrics` via `@opentelemetry/exporter-prometheus` plugged into the OTel SDK's `metricReader`. Jaeger's SPM is wired to Prometheus so I get RED metrics per service directly in the Jaeger UI without a separate pipeline.

Auto-instrumentation covers HTTP duration/count/active-requests. On top of that, each service tracks business-level counters and histograms:

**Custom metrics per service:**

| Metric | Service | Type |
|--------|---------|------|
| `gateway_requests_total` | api-gateway | Counter |
| `gateway_errors_total` | api-gateway | Counter |
| `users_created_total` | user-service | Counter |
| `orders_created_total` | order-service | Counter |
| `orders_errors_total` | order-service | Counter |
| `order_value` | order-service | Histogram |
| `notifications_sent_total` | notification-service | Counter |
| `notifications_failed_total` | notification-service | Counter |
| `notification_processing_duration_ms` | notification-service | Histogram |

Grafana at `http://localhost:3100` loads a pre-configured dashboard with RED metrics, latency percentiles (p50/p95/p99), and business metric stat panels. Credentials: `admin / admin`.

### Logs (Winston + Loki)
All services share a `createLogger(serviceName)` factory that hooks into the active OTel span and injects `traceId`/`spanId` into every log line automatically. Promtail scrapes container stdout, ships to Loki, and Grafana's Loki datasource is configured with a derived field so clicking a `traceId` in the log panel jumps straight to the Jaeger trace.

```json
{ "level": "info", "message": "Order created", "service": "order-service",
  "traceId": "4bf92f...", "spanId": "00f067...", "orderId": 3, "total": 49.99 }
```

Set `LOG_LEVEL=debug` (default: `info`) to increase verbosity.

> `OTEL_TRACES_SAMPLER` defaults to `always_on` here — fine for local. In production I'd swap to `parentbased_traceidratio` at something like 10% to avoid the SDK becoming a bottleneck under real load.

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

Service ports: API Gateway `:3000` · User `:3001` · Order `:3002` · Notification `:3003` · Jaeger UI `:16686` · Prometheus `:9090` · Grafana `:3100` (admin/admin) · Alertmanager `:9093` · Loki `:3110`

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
├── services/shared/logger/   # Winston logger with trace context injection
├── lambda/                   # Order validator (AWS Lambda)
├── infrastructure/terraform/ # ECS, Lambda, SQS, networking
├── configs/                  # Prometheus, Grafana provisioning, OTel config
│   ├── prometheus.yml
│   └── grafana/              # datasources.yml, dashboards.yml, dashboards/
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

```bash
docker-compose up --build
./scripts/traffic-simulator.sh   # generates realistic load in the background
```

| UI | URL | |
|---|---|---|
| Jaeger | http://localhost:16686 | trace the full order flow: gateway → order-service → queue → notification-service |
| Grafana | http://localhost:3100 | RED metrics, p50/p95/p99, SLO error budget panels |
| Grafana → Explore → Loki | http://localhost:3100 | structured logs — click a `traceId` to jump to Jaeger |
| Alertmanager | http://localhost:9093 | live alert state; crank up error rate to see it fire |
| Prometheus | http://localhost:9090/alerts | raw rule evaluation |

---

## Notes

- No auth, plain HTTP, no secret management — this is a local experiment, not a hardened service
- `LOG_LEVEL=debug` on any service to see the full structured JSON noise

**Documentation**: [PLAN_SRE.md](PLAN_SRE.md) · [infrastructure/terraform/README.md](infrastructure/terraform/README.md) · [lambda/README.md](lambda/README.md)

---

**Built with**: OpenTelemetry · TypeScript · Express · Jaeger · Prometheus · Grafana · Redis · AWS SQS · ECS Fargate · Lambda · Terraform

**Contact**: [jeziellcarvalho@gmail.com](mailto:jeziellcarvalho@gmail.com) · [linkedin.com/in/jezielcarvalho](https://linkedin.com/in/jezielcarvalho)

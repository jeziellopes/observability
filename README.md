# Observability Demo - Microservices with OpenTelemetry

A portfolio project demonstrating distributed tracing and observability using OpenTelemetry, microservices, Docker, and Terraform on AWS.

## 🎯 Project Overview

This project showcases:
- **Microservices Architecture** - 4 TypeScript services with REST APIs
- **Distributed Tracing** - OpenTelemetry instrumentation across all services
- **Async Processing** - Redis queue with trace context propagation
- **Serverless Integration** - AWS Lambda with tracing
- **Container Orchestration** - Docker Compose for local dev, ECS Fargate for production
- **Infrastructure as Code** - Terraform for AWS deployment

## 🧪 Demonstration

![Screen](./sample.png)

## 📊 Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       v
┌─────────────────┐
│  API Gateway    │──────────────┐
│   (Port 3000)   │              │
└────────┬────────┘              │
         │                       │
    ┌────┴────┐                  │
    │         │                  │
    v         v                  v
┌─────────┐ ┌─────────┐    ┌─────────┐
│  User   │ │  Order  │    │ Lambda  │
│ Service │ │ Service │    │Validator│
│  :3001  │ │  :3002  │    └─────────┘
└─────────┘ └────┬────┘
                 │
                 v
            ┌─────────┐
            │  Redis  │
            │  Queue  │
            └────┬────┘
                 │
                 v
          ┌─────────────┐
          │Notification │
          │   Service   │
          │    :3003    │
          └─────────────┘
                 │
                 v
          ┌─────────────┐
          │   Jaeger    │
          │ (Tracing UI)│
          │   :16686    │
          └─────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- AWS CLI (for deployment)
- Terraform (for infrastructure)

### Local Development

1. **Clone and setup**
```bash
git clone <repository>
cd observability
```

2. **Start all services**
```bash
docker-compose up --build
```

3. **Access services**
- API Gateway: http://localhost:3000
- Jaeger UI: http://localhost:16686
- User Service: http://localhost:3001
- Order Service: http://localhost:3002
- Notification Service: http://localhost:3003

### Test Distributed Tracing

```bash
# Create a user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "email": "john@example.com"}'

# Create an order (triggers full trace across services)
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "items": ["Product A", "Product B"],
    "total": 149.99
  }'

# View trace in Jaeger
open http://localhost:16686
```

## 📁 Project Structure

```
observability/
├── services/
│   ├── api-gateway/         # Entry point service
│   ├── user-service/        # User management
│   ├── order-service/       # Order processing + queue
│   └── notification-service/ # Queue consumer
├── lambda/                  # Serverless function
│   └── src/index.ts        # Order validator
├── infrastructure/
│   └── terraform/          # AWS deployment
├── configs/                # Shared OpenTelemetry config
├── docker-compose.yml      # Local orchestration
├── PLAN.md                 # Implementation plan
└── TASKS.md               # Detailed task list
```

## 🔍 Observability Features

### OpenTelemetry Instrumentation
- **Automatic**: HTTP requests, database calls, Redis operations
- **Manual**: Custom business logic spans
- **Context Propagation**: Traces flow across service boundaries and queues

### Trace Scenarios
1. **API Gateway → User Service** - Simple request flow
2. **API Gateway → Order Service → User Service** - Multi-service call
3. **Order Service → Redis → Notification Service** - Async processing
4. **API Gateway → Lambda** - Serverless integration

### Jaeger Features
- View end-to-end request traces
- Analyze service dependencies
- Identify performance bottlenecks
- Track error propagation

## 🛠️ Development

### Build individual service
```bash
cd services/api-gateway
npm install
npm run build
npm start
```

### Run in development mode
```bash
npm run dev  # Uses ts-node
```

### Build Lambda function
```bash
cd lambda
npm install
npm run build  # Creates lambda.zip
```

## ☁️ AWS Deployment

### 1. Build and push Docker images
```bash
export AWS_ACCOUNT_ID="your-account-id"
export AWS_REGION="us-east-1"

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build and push
./infrastructure/scripts/build-and-push.sh
```

### 2. Deploy with Terraform
```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars

terraform init
terraform plan
terraform apply
```

### 3. Get endpoints
```bash
terraform output api_gateway_url
terraform output lambda_function_name
```

## 📊 Monitoring

### CloudWatch Logs
```bash
aws logs tail /ecs/observability-demo --follow
```

### Service Health
```bash
curl http://<alb-dns>/health
```

### Lambda Invocation
```bash
aws lambda invoke \
  --function-name observability-demo-order-validator \
  --payload '{"body":"{\"userId\":1,\"items\":[\"test\"],\"total\":99.99}"}' \
  response.json
```

## 🧪 Testing

### API Endpoints

**Users**
```bash
# Get all users
GET /api/users

# Get user by ID
GET /api/users/:id

# Create user
POST /api/users
{
  "name": "Jane Doe",
  "email": "jane@example.com"
}
```

**Orders**
```bash
# Get all orders
GET /api/orders

# Get order by ID (includes user data)
GET /api/orders/:id

# Create order (validates user, publishes to queue)
POST /api/orders
{
  "userId": 1,
  "items": ["Item 1", "Item 2"],
  "total": 99.99
}
```

## 🎓 Learning Outcomes

This project demonstrates:
- TypeScript in production microservices
- OpenTelemetry SDK integration
- Distributed tracing patterns
- Service-to-service communication
- Async messaging with trace context
- Container orchestration
- Infrastructure as Code
- Serverless observability

## 📝 Documentation

- [PLAN.md](PLAN.md) - Overall strategy and architecture decisions
- [TASKS.md](TASKS.md) - Detailed implementation checklist
- [infrastructure/terraform/README.md](infrastructure/terraform/README.md) - Deployment guide
- [lambda/README.md](lambda/README.md) - Lambda function details

## 💰 Cost Estimation (AWS)

- **ECS Fargate**: ~$30-50/month (minimal CPU/memory)
- **ALB**: ~$16/month
- **NAT Gateway**: ~$32/month
- **Lambda**: Free tier eligible
- **CloudWatch**: Free tier eligible

**Total**: ~$80-100/month (can be reduced using spot instances)

## 🧹 Cleanup

### Local
```bash
docker-compose down -v
```

### AWS
```bash
cd infrastructure/terraform
terraform destroy
```

## 🔐 Security Notes

⚠️ **This is a demo project** - not production-ready:
- No authentication/authorization
- Public ALB with HTTP only
- No secret management
- Basic security groups
- No WAF or DDoS protection

For production:
- Add AWS WAF
- Use HTTPS with ACM certificates
- Implement AWS Secrets Manager
- Add API authentication (JWT, API keys)
- Enable VPC Flow Logs
- Implement proper IAM policies

## 🤝 Contributing

This is a portfolio project, but feedback is welcome!

## 📄 License

MIT

## 🙋 Contact

Portfolio project by [Your Name]
- GitHub: [your-github]
- LinkedIn: [your-linkedin]

---

**Built with**: TypeScript • Node.js • Express • OpenTelemetry • Jaeger • Redis • Docker • AWS ECS • Lambda • Terraform

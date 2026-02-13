#!/bin/bash
set -e

echo "🧪 Testing Observability Demo Setup"
echo "===================================="
echo ""

echo "1️⃣  Testing API Gateway Health..."
curl -s http://localhost:3000/health | jq .
echo ""

echo "2️⃣  Creating a test user..."
USER_RESPONSE=$(curl -s -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Johnson","email":"alice@example.com"}')
echo "$USER_RESPONSE" | jq .
USER_ID=$(echo "$USER_RESPONSE" | jq -r '.id')
echo "✅ Created user with ID: $USER_ID"
echo ""

echo "3️⃣  Fetching user details..."
curl -s "http://localhost:3000/api/users/$USER_ID" | jq .
echo ""

echo "4️⃣  Creating an order for the user..."
ORDER_RESPONSE=$(curl -s -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d "{\"userId\":$USER_ID,\"items\":[\"Laptop\",\"Mouse\"],\"total\":1299.99}")
echo "$ORDER_RESPONSE" | jq .
ORDER_ID=$(echo "$ORDER_RESPONSE" | jq -r '.id')
echo "✅ Created order with ID: $ORDER_ID"
echo ""

echo "5️⃣  Fetching order details with enriched user data..."
curl -s "http://localhost:3000/api/orders/$ORDER_ID" | jq .
echo ""

echo "6️⃣  Waiting for notification processing (5 seconds)..."
sleep 5
echo ""

echo "7️⃣  Checking notification service logs..."
docker-compose logs --tail=20 notification-service | grep "Email sent\|Processing notification"
echo ""

echo "✅ All tests completed successfully!"
echo ""
echo "🔍 View distributed traces at: http://localhost:16686"
echo "   Search for service: api-gateway, user-service, or order-service"

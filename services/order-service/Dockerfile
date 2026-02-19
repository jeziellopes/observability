FROM node:20-alpine AS builder

WORKDIR /app/services/order-service

# Copy package files and tsconfig
COPY services/order-service/package*.json ./
COPY services/order-service/tsconfig.json ./
COPY tsconfig.base.json ../../tsconfig.base.json

# Install all dependencies (including dev for TypeScript)
RUN npm install && ln -s /app/services/order-service/node_modules /app/services/node_modules

# Copy source code and shared library
COPY services/order-service/src ./src
COPY services/shared ../../services/shared

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app/services/order-service

# Copy package files
COPY services/order-service/package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy built application from builder
COPY --from=builder /app/services/order-service/dist ./dist

# Expose port
EXPOSE 3002

# Start application
CMD ["node", "dist/order-service/src/index.js"]

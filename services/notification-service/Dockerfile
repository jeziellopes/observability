FROM node:20-alpine AS builder

WORKDIR /app/services/notification-service

# Copy package files and tsconfig
COPY services/notification-service/package*.json ./
COPY services/notification-service/tsconfig.json ./
COPY tsconfig.base.json ../../tsconfig.base.json

# Install all dependencies (including dev for TypeScript)
RUN npm install && ln -s /app/services/notification-service/node_modules /app/services/node_modules

# Copy source code and shared library
COPY services/notification-service/src ./src
COPY services/shared ../../services/shared

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app/services/notification-service

# Copy package files
COPY services/notification-service/package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy built application from builder
COPY --from=builder /app/services/notification-service/dist ./dist

# Expose port
EXPOSE 3003

# Start application
CMD ["node", "dist/notification-service/src/index.js"]

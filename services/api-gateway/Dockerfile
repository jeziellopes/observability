FROM node:24-alpine AS builder

WORKDIR /app/services/api-gateway

# Copy package files and tsconfig
COPY services/api-gateway/package*.json ./
COPY services/api-gateway/tsconfig.json ./
COPY tsconfig.base.json ../../tsconfig.base.json

# Install all dependencies (including dev for TypeScript)
RUN npm install && ln -s /app/services/api-gateway/node_modules /app/services/node_modules

# Copy source code and shared library
COPY services/api-gateway/src ./src
COPY services/shared ../../services/shared

# Build TypeScript
RUN npm run build

# Production stage
FROM node:24-alpine

WORKDIR /app/services/api-gateway

# Copy package files
COPY services/api-gateway/package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy built application from builder
COPY --from=builder /app/services/api-gateway/dist ./dist

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "dist/api-gateway/src/index.js"]

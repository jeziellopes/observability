FROM node:24-alpine AS builder

WORKDIR /app/services/user-service

# Copy package files and tsconfig
COPY services/user-service/package*.json ./
COPY services/user-service/tsconfig.json ./
COPY tsconfig.base.json ../../tsconfig.base.json

# Install all dependencies (including dev for TypeScript)
RUN npm install && ln -s /app/services/user-service/node_modules /app/services/node_modules

# Copy source code and shared library
COPY services/user-service/src ./src
COPY services/shared ../../services/shared

# Build TypeScript
RUN npm run build

# Production stage
FROM node:24-alpine

WORKDIR /app/services/user-service

# Copy package files
COPY services/user-service/package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy built application from builder
COPY --from=builder /app/services/user-service/dist ./dist

# Expose port
EXPOSE 3001

# Start application
CMD ["node", "dist/user-service/src/index.js"]

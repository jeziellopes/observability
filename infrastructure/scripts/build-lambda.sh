#!/bin/bash
set -e

# Build Lambda function and produce lambda.zip
# Usage: ./build-lambda.sh
# Can be run from any directory.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_DIR="$SCRIPT_DIR/../../lambda"

echo "Building Lambda function..."
echo "Lambda directory: $LAMBDA_DIR"
echo ""

cd "$LAMBDA_DIR"

# Install dependencies
echo "Installing dependencies..."
pnpm install --frozen-lockfile

# Build (compiles TypeScript + packages into lambda.zip via package.json scripts)
echo "Compiling TypeScript and packaging..."
pnpm build

if [ -f "$LAMBDA_DIR/lambda.zip" ]; then
  SIZE=$(du -sh "$LAMBDA_DIR/lambda.zip" | cut -f1)
  echo ""
  echo "========================================"
  echo "Lambda built successfully!"
  echo "Output: lambda/lambda.zip ($SIZE)"
  echo "========================================"
else
  echo "Error: lambda.zip was not created"
  exit 1
fi

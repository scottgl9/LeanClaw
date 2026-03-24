FROM node:20-slim

# Minimal packages for agent execution
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r agent && useradd -r -g agent -m -d /home/node -s /bin/bash node

# Working directories
RUN mkdir -p /workspace/group /workspace/ipc /app/src && \
    chown -R node:agent /workspace /app

WORKDIR /app

# Copy agent-runner source
COPY agent-runner/ /app/

# Install agent dependencies
RUN npm install --production 2>/dev/null || true

USER node

# Environment defaults
ENV HOME=/home/node
ENV NODE_ENV=production

ENTRYPOINT ["node", "/app/src/index.js"]

# Use a specialized Puppeteer image to avoid shared library issues on Linux (essential for Render)
# Using a specific version (21.5.0) instead of 'latest' for more predictable builds and better caching
FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Switch to root to perform installation
USER root

WORKDIR /app

# Biến môi trường để Puppeteer KHÔNG tải lại Chrome (đã có sẵn trong base image)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

# 1. Copy package files first to leverage Docker layer caching for dependencies
COPY package*.json ./

# 2. Install dependencies (this layer will be cached unless package.json changes)
RUN npm install

# 3. Copy the rest of the application (changes here won't trigger re-installing npm packages)
COPY . .

# Expose the port Render provides
EXPOSE 3000

# Run the app
CMD ["node", "server.js"]

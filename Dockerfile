# Use a specialized Puppeteer image to avoid shared library issues on Linux (essential for Render)
FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Switch to root to install or move files if necessary, then back to pptruser
USER root

WORKDIR /app

# Biến môi trường để Puppeteer KHÔNG tải lại Chrome (đã có sẵn trong base image)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Expose the port Render provides
EXPOSE 3000

# Run the app
CMD ["node", "server.js"]

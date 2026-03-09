# Sử dụng Puppeteer base image có sẵn Chrome
FROM ghcr.io/puppeteer/puppeteer:22.15.0

# Chuyển sang quyền root để thao tác file
USER root

# Thiết lập thư mục làm việc
WORKDIR /app

# Biến môi trường quan trọng cho Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome \
    PORT=8080

# Sao chép package.json và cài đặt thư viện
COPY package*.json ./
RUN npm install

# Sao chép toàn bộ mã nguồn
COPY . .

# Phân quyền cho app (chuyển sở hữu thư mục app cho pptruser)
RUN chown -R pptruser:pptruser /app

# Quay lại user an toàn của puppeteer để chạy app
USER pptruser

# Mở port (Render sẽ tự nhận diện port 8080)
EXPOSE 8080

# Chạy server
CMD ["node", "server.js"]

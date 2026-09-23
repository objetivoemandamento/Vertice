FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
EXPOSE 8080
USER node
CMD ["npm","start"]

FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY *.mjs ./

ENV PORT=8000
EXPOSE 8000

CMD ["npm", "start"]

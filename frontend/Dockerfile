# Step 1: Build the React app
FROM node:18-alpine as build-stage
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Step 2: Run the production server
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=build-stage /app/dist ./dist
COPY --from=build-stage /app/server ./server
# Ensure .env is available if not using orchestration env vars
COPY .env ./ 

EXPOSE 3000
CMD ["node", "server/index.js"]

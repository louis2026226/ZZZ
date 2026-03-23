# 构建前端时传入部署地址，例如：
# docker build --build-arg VITE_SOCKET_URL=http://8.134.168.87:3000 -t room-game .
FROM node:20-alpine AS client
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ .
ARG VITE_SOCKET_URL=http://8.134.168.87:3000
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev
COPY server/ ./server/
COPY --from=client /app/client/dist ./client/dist
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
WORKDIR /app/server
CMD ["node", "index.js"]

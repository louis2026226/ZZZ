const path = require('path')

/**
 * PM2：在 louis-zz 根目录执行 pm2 start ecosystem.config.cjs
 * - room-game：改 server/ 下文件会自动重启
 * - room-game-watch：监听 client/ 源码，保存后自动 vite build（需文件在服务器上被更新）
 * 若只在本地 Windows 开发，在 client 目录用 npm run dev 即可热更新，不必 build。
 */
module.exports = {
  apps: [
    {
      name: 'room-game',
      cwd: __dirname,
      script: 'server/index.js',
      instances: 1,
      watch: ['server'],
      ignore_watch: ['node_modules'],
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        ADMIN_PASSWORD: 'admin888',
        CLIENT_ORIGIN: 'http://8.134.168.87:3000,http://8.134.168.87:3390',
      },
    },
    {
      name: 'room-game-watch',
      cwd: path.join(__dirname, 'client'),
      script: 'npm',
      args: 'run build:watch',
      env: {
        NODE_ENV: 'production',
        VITE_SOCKET_URL: 'http://8.134.168.87:3000',
      },
    },
  ],
}

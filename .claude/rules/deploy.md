# 部署 / 版本 / 环境变量模块记忆

## 双端部署
- **Railway**：推送 GitHub 自动触发，约 1-3 分钟生效，访问域名（`.up.railway.app`）
- **自托管服务器**：IP `8.134.168.87`，路径 `/root/louis-zz`，使用 PM2 管理
  - 手动更新命令：`cd /root/louis-zz && bash deploy.sh`
  - 自动更新：GitHub Actions（`deploy.yml`），需配置 Secrets

## GitHub Actions 自动部署配置
- Variable：`DEPLOY_SSH_ENABLED = true`
- Secrets：`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` / `DEPLOY_PATH`
- 触发条件：push 到 main 分支

## 版本号同步（每次必须同步更新）
1. `client/package.json` → `version` 字段
2. `server/package.json` → `version` 字段
3. `client/src/pages/BLogin.jsx` → 底部版本文字
4. `client/src/pages/CLogin.jsx` → 底部版本文字

## 环境变量
- `PORT`：主服务端口（默认 3000）
- `SUPER_ADMIN_PORT`：超管端口（默认 3390，设 0 禁用）
- `ADMIN_PASSWORD`：B端登录密码（默认 admin888）
- `VITE_SOCKET_URL`：构建时指定 Socket 地址

## 注意事项
- 用户手机访问的是 IP 地址（自托管），不是 Railway 域名
- 推送后两端都需要更新：Railway 自动，服务器需手动或配置 Actions
- 手机缓存问题：用无痕浏览器或在 URL 后加 `?v=版本号` 强制刷新

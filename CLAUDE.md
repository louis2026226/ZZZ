# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a real-time multiplayer betting game with rooms. The project consists of:
- **Client**: React 18 + Vite + Tailwind CSS frontend
- **Server**: Node.js + Express + Socket.IO backend
- **Deployment**: Docker for Railway, PM2 for self-hosting, with automated deployment via GitHub Actions

Two main user roles:
- **B (Admin)**: Creates rooms, starts rounds, settles bets, views statistics
- **C (Player)**: Joins rooms, places bets on numbers 1-4
- **Super Admin**: Manages B accounts (authorize/disable/ban) and views global stats

## Project Guide: Core Business Logic & Standards

### 1. Core Business Logic (DO NOT VIOLATE)
- **Dual-Role Logic**: The app must handle two distinct states: B-End (Admin) and C-End (Player).
- **Admin Constraints**: Admin sets `TotalRounds` and `MaxBetAmount` during room creation.
- **Room Plate**: Every room MUST have a centered UI component sized exactly **100px × 120px** showing Room ID, Player Count, and Round Status.
- **Betting Rules**:
  - Players choose 1 or 2 numbers from {1, 2, 3, 4}.
  - Betting amounts MUST be multiples of 5 (e.g., 5, 10, 25, 100).
  - Each round randomly displays 10 amount buttons from a predefined pool.
  - Validation: Player bet cannot exceed the Admin's `MaxBetAmount`.

### 2. Real-Time & UI Standards
- **Message Board**: Occupies the top 40% of the screen. Must support `overflow-y: auto` and historical scroll.
- **Timer**: A yellow progress bar at the top, typically 30 seconds (configurable to 30 or 60 seconds by admin).
- **Sync**: All bets and results must be broadcasted via Socket.IO to ALL users in the room immediately.
- **Settlement**: After Admin enters the winning number (1-4), calculate Win/Loss for every player and display in the Message Board.

### 3. Technical Implementation Patterns
- **State Management**: Use React Context for global game state (History, User Info, Timer).
- **Socket Events**: Follow consistent naming convention (actual events: `b_start_round`, `c_submit_bet`, `b_settle`, etc.)
- **Coding Style**:
  - Use functional components and Hooks.
  - Keep Tailwind classes clean (use @apply for repetitive styles if necessary).
- **Build/Dev**: `npm run build` for production, `npm run dev` for development.

### 4. Mock/Future Features
- **Identity**: Currently use manual name input. Prepare UI slots for WeChat avatar/nickname integration.
- **Persistence**: Store `gameHistory` in a way that survives page refreshes during the session.
- **Server IP**: Production target is `8.134.168.87`.

## Common Development Tasks

### Local Development
1. **Start client dev server** (hot reload):
   ```bash
   cd client
   npm run dev
   ```
   Client runs on `http://localhost:5173` by default.

2. **Start server** (no auto-reload):
   ```bash
   cd server
   npm run dev
   ```
   Server runs on `http://localhost:3000` by default.

3. **Simultaneous dev with PM2** (watches both):
   ```bash
   pm2 start ecosystem.config.cjs
   ```
   This starts two processes:
   - `room-game`: server with file watching (restarts on changes)
   - `room-game-watch`: client build watcher (rebuilds on changes)

### Building for Production
- **Build client**:
  ```bash
  cd client
  npm run build
  ```
  Outputs to `client/dist`.

- **Build with Docker** (for Railway):
  ```bash
  docker build --build-arg VITE_SOCKET_URL=https://your-domain.com -t room-game .
  ```

### Testing
No test suite currently configured.

### Deployment
- **Railway**: Push to GitHub (connected repo) → automatic deploy from Dockerfile
- **Self-hosted (PM2)**:
  ```bash
  bash deploy.sh
  ```
  This script:
  1. Updates git repo
  2. Installs client dependencies and builds
  3. Installs server dependencies (production)
  4. Restarts PM2 processes

- **GitHub Actions**: SSH deploy triggered when `DEPLOY_SSH_ENABLED=true` and secrets configured.

## Architecture

### Client (`client/src/`)
- **Routing**: React Router with pages:
  - `/` – Home page with role selection
  - `/login/b` – B admin login
  - `/login/c` – C player login
  - `/b/dashboard` – Admin room interface
  - `/c/play` – Player room interface
  - `/super-admin` – Super admin login
  - `/super-admin/panel` – Super admin panel
- **Socket.IO**: Connection managed in `src/socket.js`
- **Components**: Reusable UI in `src/components/`
- **State**: Local React state + Socket.IO events for real-time updates

### Server (`server/index.js`)
- **Rooms**: In-memory `Map` storing room state (no database)
- **Socket.IO Events**:
  - Authentication: `b_login`, `c_login`, `super_admin_login`
  - Room management: `b_create_room`, `b_list_my_rooms`, `b_join_existing`, `c_join_room`
  - Game flow: `b_start_round`, `c_submit_bet`, `b_settle`, `b_dismiss_room`
  - Super admin: `super_admin_list_b`, `super_admin_update_b`
- **Game Logic**:
  - Betting phases: `idle` → `betting` → `closed` → `countdown` → `betting` (next round)
  - Timer management with `setInterval`/`setTimeout`
  - Bet validation: numbers 1-4, amount multiples of 5, max per room
  - Settlement: compares bets to lucky number (1-4)
- **Statistics**: Tracks per-admin P&L and player activity in memory

### Port Configuration
- **Main port**: `PORT` env var (default 3000) – serves client assets and Socket.IO
- **Super admin port**: `SUPER_ADMIN_PORT` env var (default 3390, disable with `0` or `false`) – separate server instance for admin UI

## Environment Variables

### Server
- `PORT`: Main server port (default: 3000)
- `SUPER_ADMIN_PORT`: Separate port for super admin UI (default: 3390, set to `0` to disable)
- `ADMIN_PASSWORD`: Password for B admin login (default: `admin888`)
- `CLIENT_ORIGIN`: CORS origin for Socket.IO (default: `*`)
- `SUPER_ADMIN_USER`: Super admin username (default: `admin`)
- `SUPER_ADMIN_PASS`: Super admin password (default: `123456`)

### Client (build-time)
- `VITE_SOCKET_URL`: Socket.IO server URL (default: empty = same origin)

## Version Management

- **Version number** must be kept in sync:
  1. `client/package.json` – `version` field
  2. `server/package.json` – `version` field
  3. `client/src/App.jsx` – bottom-left `Vx.x.x` text
- **After updating version**, commit and push to trigger deployment
- **Deployment message**: Include version number when notifying user about push

## Cursor Rules Summary

From `.cursor/rules/execute-first.mdc`:
- **Execute directly**: Run commands yourself when possible, don't ask user to run them
- **Verify information**: Check repo/docs before assuming paths/APIs/behavior
- **Minimal explanations**: Avoid lengthy background, keep instructions concise
- **No nano**: Provide copy-paste alternatives for file edits
- **Auto-push**: After committing, run `git push origin main` (if origin configured)
- **Deployment notice**: After push, mention version number and that Railway will auto-deploy (~1-3 minutes)

## Important Notes

- **No database**: All state is in memory – server restart loses rooms and stats
- **Super admin UI**: Accessible via separate port (default 3390) if enabled
- **Bet limits**: Single bet amount must be multiple of 5, max per room set by admin
- **Room auto-cleanup**: Empty rooms (no sockets) are destroyed after 1 minute
- **Multi-bet per round**: Players can place multiple bets per round, but limited to 2 distinct numbers total
- **Build output**: Server serves `client/dist` statically; ensure build exists before production

## 自动记忆维护 (Memory Maintenance)

- **任务自检**：每次完成一个独立需求或修复 Bug 后，必须主动更新 `.claude/rules/` 下对应的模块文件。
- **记录内容**：
  1. 本次修改的核心逻辑
  2. 新增的配置项或 Socket 事件
  3. 任何需要持久记忆的特殊决策（例如：为什么这样设计）
- **禁止口头总结**：不要仅在对话中告诉用户做了什么，必须写入文件。
- **模块归属**：
  - 游戏逻辑（下注、结算、房间状态）→ `.claude/rules/logic.md`
  - UI / 角色权限（B端/C端显示差异）→ `.claude/rules/ui.md`
  - 部署 / 版本 / 环境变量 → `.claude/rules/deploy.md`

## Claude Code Project Rules

### Critical Workflow (Test-Driven)
1. **Before Implementation**: For any new feature or bug fix, you MUST first create or update a test case (e.g., using Vitest, Jest, or Playwright).
2. **During Development**: Run the specific test case to confirm it fails as expected (Red light).
3. **After Implementation**: Run the full test suite or the relevant test file to ensure it passes (Green light).
4. **Verification**: You are NOT allowed to say "Task Complete" until you have shared the test execution output in the terminal.

### Commands
- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit`

# CampusPark / CampusPark（校园泊车）

CampusPark is a full-stack parking reservation platform built around the Seattle South Lake Union urban campus ecosystem. It is designed as an O2O parking experience: users discover nearby garages online, reserve a spot, navigate to the physical location, check in with a paper ticket, and complete settlement when exiting.
CampusPark 是一款围绕西雅图 South Lake Union 城市校园生态打造的全栈停车预约平台。它被设计为 O2O 停车体验：用户在线发现附近车库、预订车位、导航到线下地点、用纸质票据办理入场，并在离场时完成结算。

This project is built with Vanilla JS on the frontend and a Node.js + Prisma + PostgreSQL backend, and is deployed on Render.
本项目前端采用原生 JavaScript，后端使用 Node.js + Prisma + PostgreSQL，并部署在 Render。

## Highlights
## 亮点

- User-first parking discovery flow with a split-screen search layout
- 以用户为中心的停车发现流程，采用左右分屏搜索布局
- Separate user, reservations, login, and admin experiences
- 用户、预约、登录与管理员体验相互独立
- Live parking inventory with search, zone filters, and EV-only filtering
- 实时车位库存，支持搜索、分区筛选与仅 EV 过滤
- Google Maps integration path for location preview and navigation
- 集成 Google Maps 进行位置预览与导航
- Reservation lifecycle with real-world status transitions: `PENDING -> ACTIVE -> COMPLETED`
- 预约生命周期贴近现实：`PENDING -> ACTIVE -> COMPLETED`
- Ticket digitization via 6-digit paper ticket check-in
- 通过 6 位纸质票据完成数字化入场
- Checkout settlement with parking duration and final amount
- 基于停车时长的结算与最终金额计算
- Admin-facing operations view for inventory and activity
- 面向管理员的库存与运营视图
- Traffic simulation with `node-cron` to make demo inventory feel realistic
- 使用 `node-cron` 进行流量模拟，使演示库存更真实
- PWA shell with `manifest.json` and `service-worker.js`
- 提供 PWA 外壳，包含 `manifest.json` 与 `service-worker.js`

## Product Flow
## 产品流程

### Normal user
### 普通用户

1. Open the discover page
1. 打开发现页
2. Browse parking results on the left and map on the right
2. 左侧浏览停车结果，右侧查看地图
3. Filter by zone, arrival time, duration, and EV availability
3. 按区域、到达时间、时长与 EV 可用性筛选
4. Reserve a spot
4. 预订车位
5. Navigate to the garage
5. 导航至车库
6. Check in with the physical ticket code
6. 使用纸质票据码办理入场
7. View reservations in `My Reservations`
7. 在 `My Reservations` 中查看预约
8. Check out and settle when leaving
8. 离场时结算并完成出场

### Admin
### 管理员

Admins sign in separately and can access an admin console with inventory and operational stats without cluttering the normal user flow.
管理员独立登录，可进入管理员控制台查看库存与运营数据，不干扰普通用户流程。

## Tech Stack
## 技术栈

- Frontend: HTML, CSS, Vanilla JavaScript
- 前端：HTML、CSS、原生 JavaScript
- Backend: Node.js HTTP server
- 后端：Node.js HTTP 服务器
- ORM: Prisma
- ORM：Prisma
- Database: PostgreSQL
- 数据库：PostgreSQL
- Scheduling: `node-cron`
- 调度：`node-cron`
- Deployment: Render
- 部署：Render
- Maps: Google Maps JavaScript API + Geocoding API
- 地图：Google Maps JavaScript API + Geocoding API

## Project Structure
## 项目结构

- [index.html](/Users/Zhuanz/Desktop/app/index.html): app shell, route views, dialogs, and templates
- [index.html](/Users/Zhuanz/Desktop/app/index.html)：应用外壳、路由视图、对话框与模板
- [styles.css](/Users/Zhuanz/Desktop/app/styles.css): UI system, responsive layout, glassmorphism styling
- [styles.css](/Users/Zhuanz/Desktop/app/styles.css)：UI 系统、响应式布局、玻璃拟态风格
- [app.js](/Users/Zhuanz/Desktop/app/app.js): frontend state, routing, rendering, booking flows, map logic
- [app.js](/Users/Zhuanz/Desktop/app/app.js)：前端状态、路由、渲染、预约流程、地图逻辑
- [server.js](/Users/Zhuanz/Desktop/app/server.js): API routes, auth, reservations, traffic simulation, static serving
- [server.js](/Users/Zhuanz/Desktop/app/server.js)：API 路由、鉴权、预约、流量模拟、静态资源服务
- [prisma/schema.prisma](/Users/Zhuanz/Desktop/app/prisma/schema.prisma): database schema
- [prisma/schema.prisma](/Users/Zhuanz/Desktop/app/prisma/schema.prisma)：数据库结构
- [prisma/seed.js](/Users/Zhuanz/Desktop/app/prisma/seed.js): seed script for parking data
- [prisma/seed.js](/Users/Zhuanz/Desktop/app/prisma/seed.js)：停车数据初始化脚本
- [manifest.json](/Users/Zhuanz/Desktop/app/manifest.json): PWA metadata
- [manifest.json](/Users/Zhuanz/Desktop/app/manifest.json)：PWA 元数据
- [service-worker.js](/Users/Zhuanz/Desktop/app/service-worker.js): PWA service worker
- [service-worker.js](/Users/Zhuanz/Desktop/app/service-worker.js)：PWA Service Worker

## Main Features
## 主要功能

### 1. Parking discovery
### 1. 停车发现

- Search by landmark or address
- 支持按地标或地址搜索
- Filter by zone
- 支持按区域筛选
- Choose arrival time and duration
- 可选择到达时间与停车时长
- Toggle EV-only results
- 可切换仅显示 EV 车位
- Compare availability and price directly in result cards
- 可在结果卡片中直接对比可用性与价格

### 2. Reservations
### 2. 预约

- Create a reservation for a parking spot
- 可创建停车位预约
- Validate reservation conflicts
- 进行预约冲突校验
- View current and past reservations
- 查看当前与历史预约
- Cancel bookings
- 可取消预约
- Export reservation data
- 可导出预约数据

### 3. Ticket digitization
### 3. 票据数字化

Users can convert a physical paper garage ticket into a digital state transition:
用户可将纸质车库票据转为数字化状态流转：

- `POST /api/check-in`
- `POST /api/check-in`
- Accepts a 6-digit ticket code
- 接收 6 位票据码
- Moves reservation status from `PENDING` to `ACTIVE`
- 将预约状态从 `PENDING` 切换为 `ACTIVE`
- Stores `ticketCode`
- 存储 `ticketCode`
- Records `checkInTime`
- 记录 `checkInTime`

### 4. Checkout settlement
### 4. 出场结算

- `POST /api/check-out`
- `POST /api/check-out`
- Validates active booking
- 校验有效的停车预约
- Calculates final amount
- 计算最终金额
- Records `checkOutTime`
- 记录 `checkOutTime`
- Moves reservation status to `COMPLETED`
- 将预约状态切换为 `COMPLETED`

### 5. Traffic simulation
### 5. 流量模拟

The app includes a cron-driven occupancy simulator so demo inventory does not look static.
应用包含基于 cron 的占用模拟器，确保演示库存不显得静态。

- Runs every 15 minutes
- 每 15 分钟运行一次
- Uses Seattle local time
- 使用西雅图本地时间
- Simulates rush-hour pressure
- 模拟高峰期压力
- Applies jitter for more organic availability changes
- 添加抖动以产生更自然的可用性变化
- Caps occupancy for demo-friendly availability
- 对占用率做上限控制，确保演示友好

### 6. Navigation and O2O handoff
### 6. 导航与 O2O 交付

- Google Maps directions deep-linking from the selected parking spot
- 从所选车位跳转至 Google Maps 导航
- Intended to bridge online discovery to offline arrival
- 旨在连接线上发现与线下到达

### 7. PWA support
### 7. PWA 支持

- Installable app shell
- 可安装的应用外壳
- Manifest and service worker support
- Manifest 与 Service Worker 支持
- Mobile home-screen installation flow
- 移动端主屏安装流程

## Routes
## 路由

- `/` - Discover parking
- `/` - 停车发现
- `/login` - Sign in / sign up
- `/login` - 登录 / 注册
- `/reservations` - My reservations
- `/reservations` - 我的预约
- `/admin` - Admin console
- `/admin` - 管理后台

## Core API Endpoints
## 核心 API 端点

### Auth
### 鉴权

- `POST /api/auth/login`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/register`
- `POST /api/auth/logout`
- `POST /api/auth/logout`
- `GET /api/session`
- `GET /api/session`

### Parking
### 车位

- `GET /api/spots`
- `GET /api/spots`
- `GET /api/recommend`
- `GET /api/recommend`
- `POST /api/spots`
- `POST /api/spots`
- `PATCH /api/spots/:id/toggle`
- `PATCH /api/spots/:id/toggle`

### Reservations
### 预约

- `GET /api/bookings/me`
- `GET /api/bookings/me`
- `GET /api/bookings/me/export`
- `GET /api/bookings/me/export`
- `POST /api/bookings`
- `POST /api/bookings`
- `DELETE /api/bookings/:id`
- `DELETE /api/bookings/:id`
- `POST /api/check-in`
- `POST /api/check-in`
- `POST /api/check-out`
- `POST /api/check-out`

### Stats
### 统计

- `GET /api/stats`
- `GET /api/stats`

## Reservation Status Model
## 预约状态模型

The Prisma schema includes:
Prisma schema 包含：

- `PENDING`
- `PENDING`
- `ACTIVE`
- `ACTIVE`
- `COMPLETED`
- `COMPLETED`
- `CONFIRMED`
- `CONFIRMED`
- `CANCELLED`
- `CANCELLED`
- `EXPIRED`
- `EXPIRED`

`Reservation` also stores:
`Reservation` 还包含：

- `ticketCode`
- `ticketCode`
- `checkInTime`
- `checkInTime`
- `checkOutTime`
- `checkOutTime`
- `finalAmount`
- `finalAmount`

## Local Setup
## 本地启动

### 1. Install dependencies
### 1. 安装依赖

```bash
npm install
```

### 2. Configure environment variables
### 2. 配置环境变量

Create a `.env` file with your PostgreSQL connection:
创建 `.env` 文件并设置 PostgreSQL 连接：

```env
DATABASE_URL="postgresql://..."
```

If you are using Supabase with Render, a pooled connection string is recommended.
如果使用 Supabase + Render，推荐使用连接池连接串。

### 3. Generate Prisma client
### 3. 生成 Prisma 客户端

```bash
npm run prisma:generate
```

### 4. Push schema
### 4. 推送 schema

```bash
npm run prisma:push
```

### 5. Seed data
### 5. 初始化数据

```bash
npm run prisma:seed
```

### 6. Start the app
### 6. 启动应用

```bash
npm start
```

Then open:
然后访问：

```txt
http://localhost:3000
```

## Google Maps Setup
## Google Maps 配置

To enable the real map instead of the visual fallback layer:
如需启用真实地图而非占位层：

1. Create a Google Cloud project
1. 创建 Google Cloud 项目
2. Enable:
2. 启用以下服务：
   - Maps JavaScript API
   - Maps JavaScript API
   - Geocoding API
   - Geocoding API
3. Create an API key
3. 创建 API Key
4. Add HTTP referrer restrictions
4. 添加 HTTP 引荐来源限制
5. Put the key into [index.html](/Users/Zhuanz/Desktop/app/index.html):
5. 将 Key 写入 [index.html](/Users/Zhuanz/Desktop/app/index.html)：

```html
<meta name="google-maps-api-key" content="YOUR_GOOGLE_MAPS_API_KEY" />
```

Recommended referrers:
推荐的 referrer：

- `https://campus-park.onrender.com/*`
- `https://campus-park.onrender.com/*`
- `http://localhost:*/*`
- `http://localhost:*/*`

## Deployment Notes
## 部署说明

This project is intended for Render deployment.
本项目面向 Render 部署。

Recommended production checklist:
推荐的生产检查清单：

- Set `DATABASE_URL`
- 设置 `DATABASE_URL`
- Run Prisma generate during build
- 在构建阶段运行 Prisma generate
- Ensure schema is pushed before using new reservation fields
- 使用新预约字段前确保 schema 已推送
- Add Google Maps API key if map rendering is enabled
- 若启用地图渲染请添加 Google Maps API Key
- Add PWA icons:
- 添加 PWA 图标：
  - `icon-192.png`
  - `icon-192.png`
  - `icon-512.png`
  - `icon-512.png`

## Default Admin Account
## 默认管理员账号

- Username: `admin`
- 用户名：`admin`
- Password: `admin123`
- 密码：`admin123`

## Concurrency Test
## 并发测试

To run the reservation concurrency test:
运行预约并发测试：

```bash
npm run test:concurrency
```

## Portfolio Positioning
## 作品定位

CampusPark is intentionally scoped as a practical urban-campus parking product rather than a generic dashboard. The focus is on:
CampusPark 被有意定位为实用的城市校园停车产品，而非通用仪表盘。重点在于：

- decision-first user experience
- 以决策为先的用户体验
- O2O service flow
- O2O 服务流程
- operational realism
- 运营真实感
- deployable full-stack architecture
- 可部署的全栈架构

## Future Improvements
## 未来改进

- Move Google Maps API key injection to server-side env configuration
- 将 Google Maps API Key 注入改为服务端环境变量配置
- Add stronger admin analytics and trend charts
- 增强管理员分析与趋势图表
- Add better mobile bottom-sheet interactions
- 改善移动端底部抽屉交互
- Replace geocoding-on-render with stored coordinates in the database
- 用数据库存储坐标替代渲染时地理编码
- Add usage telemetry and search analytics
- 添加使用遥测与搜索分析

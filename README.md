# 习惯打卡（多用户在线版）

一个极简、好看的习惯打卡网站：**每人注册登录、数据相互独立**，手机/电脑都能用；支持 PWA"添加到主屏幕"，带 DeepSeek AI 周总结。本地运行**零依赖**，部署到免费云成本 **¥0/月**。

## 功能
- 注册 / 登录 / 退出，密码加密存储，数据按账号隔离
- 添加 / 改名 / 删除习惯，每天逐项打卡（完成变灰 + 划线动画）
- 今日进度 x/y、连续完成天数、最近 7 天历史
- 明暗主题一键切换
- PWA：手机浏览器"添加到主屏幕"后全屏打开，接近 App
- AI 周总结（DeepSeek，可选）：一键生成一周鼓励与建议

## 本地运行（零依赖，无需 npm install）
1. 安装 Node.js LTS（https://nodejs.org）
2. 双击 `启动.bat`（或 `node server.js`），浏览器打开 http://localhost:4321
3. 注册一个账号即可使用（数据存本地 `data/habits.db`）

## 云模式（数据持久化到 Turso）
设置以下环境变量后启动，数据写入 Turso 云数据库（重启不丢）：
- `TURSO_URL`：Turso 数据库地址（libsql://xxx.turso.io）
- `TURSO_AUTH_TOKEN`：Turso 数据库令牌

未设置时自动回退本地 SQLite，本地开发/测试不受影响。## 免费部署到 Render（¥0，约 15 分钟）
需要注册 4 个免费账号（都无需信用卡）：GitHub、Render、Turso、UptimeRobot。

### 1. 注册 GitHub 并上传代码
1. 注册 GitHub：https://github.com → New repository → 建一个公开仓库（如 `habit-tracker`）
2. 本机推送：
   - `git init`、`git add .`、`git commit -m "init"`
   - `git remote add origin https://github.com/你的用户名/habit-tracker.git`
   - `git branch -M main`、`git push -u origin main`

### 2. 注册 Turso 并创建数据库
1. 注册 https://turso.tech → 免费创建一个数据库，地区选离国内近的（如 Tokyo）
2. 在数据库页面生成令牌（Token），得到 `TURSO_AUTH_TOKEN`
3. 数据库地址（`libsql://xxx.turso.io`）即 `TURSO_URL`

### 3. 注册 Render 并部署
1. 注册 https://render.com（用 GitHub 登录即可）
2. New → Web Service → 选择 `habit-tracker` 仓库
3. 会自动读取 `render.yaml`（Build: `npm install`，Start: `npm start`，免费套餐）
4. 在 Environment 里填写三个变量：`TURSO_URL`、`TURSO_AUTH_TOKEN`、`DEEPSEEK_API_KEY`（DeepSeek key 在 https://platform.deepseek.com 获取）
5. 点 Deploy，完成后得到 `https://habit-tracker.onrender.com`（名字可改）

### 4. 注册 UptimeRobot 防休眠
1. 注册 https://uptimerobot.com → 免费创建监控
2. Monitor Type 选 HTTPS，URL 填 `https://你的服务.onrender.com/api/info`，间隔 5 分钟
3. 这样 Render 免费层不会被闲置回收，页面随时秒开

### 5. 分享
把 `https://你的服务.onrender.com` 发给朋友；手机浏览器打开后点"添加到主屏幕"，即可像 App 一样使用。## 环境变量一览
| 变量 | 必填 | 说明 |
|---|---|---|
| `PORT` | 否 | 端口，默认 4321（Render 会自动设为 10000） |
| `TURSO_URL` | 云模式必填 | Turso 数据库地址 |
| `TURSO_AUTH_TOKEN` | 云模式必填 | Turso 令牌 |
| `DEEPSEEK_API_KEY` | 否 | DeepSeek 密钥，不填则 AI 周总结按钮提示未配置 |

## 接口一览
- `POST /api/register` `{username, password}` → 注册并返回 token
- `POST /api/login` `{username, password}` → 登录返回 token
- `POST /api/logout`、`GET /api/me`（需登录）
- `GET /api/habits`、`POST /api/habits`、`PUT /api/habits/:id`、`DELETE /api/habits/:id`（需登录）
- `POST /api/habits/:id/toggle`（需登录）
- `GET /api/stats`、`POST /api/ai/weekly`（需登录）
- `GET /api/info`（公开，供页面底部与 UptimeRobot 保活使用）

除注册/登录/信息外，接口均需请求头 `Authorization: Bearer <token>`。

## 数据与安全
- 密码使用 Node 内置 scrypt 加盐哈希，不存明文
- 登录发放随机会话 token 存入数据库，重启后登录态仍有效
- 所有习惯/打卡数据按 `user_id` 隔离，用户之间互不可见
- DeepSeek 密钥只在服务器环境变量中，绝不出现在前端或代码库

## 常见问题
- **端口被占用**：`set PORT=4322` 后重新 `node server.js`
- **AI 提示"未配置"**：在服务器环境变量补 `DEEPSEEK_API_KEY` 后重启
- **手机打不开**：确认手机与电脑同一 Wi-Fi，使用终端/页面底部显示的局域网地址
# 习惯打卡（多用户在线版 · Vercel 免费部署）

一个极简、好看的习惯打卡网站：**每人注册登录、数据相互独立**，手机/电脑都能用；PWA 可"添加到主屏幕"，带 DeepSeek AI 周总结。**免费部署到 Vercel：用 GitHub 登录即可，无需信用卡、无需境外手机号。**

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

> 说明：本地模式数据存在本机文件里；Vercel 上没有持久磁盘，**线上必须用 Turso**（见下文）。本地不设置 `TURSO_URL` 即自动用本地 SQLite。## 免费部署到 Vercel（约 15 分钟，无需绑卡）
只需两个免费账号：**GitHub** 和 **Turso**（Vercel 用 GitHub 登录，不绑卡）。

### 1. 创建 GitHub 仓库并推送代码
1. 注册 GitHub：https://github.com → New repository → 建公开仓库（如 `habit-tracker`），**不要**勾选"Add a README"
2. 本机推送（已初始化好 git）：
   - `git remote add origin https://github.com/你的用户名/habit-tracker.git`
   - `git push -u origin main`

### 2. 创建 Turso 免费数据库（数据持久化用）
1. 注册 https://turso.tech → 免费创建数据库，区域选 Tokyo（离国内近）
2. 在数据库页面生成令牌，得到：
   - `TURSO_URL`：形如 `libsql://xxx.turso.io`
   - `TURSO_AUTH_TOKEN`：令牌字符串

### 3. 导入 Vercel（核心步骤）
1. 打开 https://vercel.com/new → 用 **GitHub 账号**登录（不绑卡）
2. Import 你的 `habit-tracker` 仓库 → 自动识别（框架选 Other，构建命令 `npm install`，输出目录为空即可）
3. 在 **Environment Variables** 填入：
   - `TURSO_URL` = 上面拿到的数据库地址
   - `TURSO_AUTH_TOKEN` = 上面拿到的令牌
   - `DEEPSEEK_API_KEY` = DeepSeek 密钥（https://platform.deepseek.com，可后补）
4. 点 **Deploy**，等 1-2 分钟，完成后得到 `https://habit-tracker.vercel.app`（可改名）

### 4. 上线与分享
- 把 `https://你的项目.vercel.app` 发给朋友；手机浏览器打开后点"添加到主屏幕"即可像 App 一样使用
- Vercel 是 Serverless，**不会休眠**，不需要 UptimeRobot 保活
- 以后每次 `git push` 到 main 分支会自动重新部署## 环境变量一览
| 变量 | 必填 | 说明 |
|---|---|---|
| `TURSO_URL` | Vercel 必填 | Turso 数据库地址（libsql://...） |
| `TURSO_AUTH_TOKEN` | Vercel 必填 | Turso 数据库令牌 |
| `DEEPSEEK_API_KEY` | 否 | DeepSeek 密钥；不填则 AI 周总结提示未配置 |
| `PORT` | 否 | 仅本地用，默认 4321 |

> Vercel 上若未配置 `TURSO_URL`/`TURSO_AUTH_TOKEN`，接口会返回"必须配置 TURSO 环境变量"的提示，避免数据丢失。

## 接口一览
- `POST /api/register` `{username, password}` → 注册并返回 token
- `POST /api/login` `{username, password}` → 登录返回 token
- `POST /api/logout`、`GET /api/me`（需登录）
- `GET /api/habits`、`POST /api/habits`、`PUT /api/habits/:id`、`DELETE /api/habits/:id`（需登录）
- `POST /api/habits/:id/toggle`（需登录）
- `GET /api/stats`、`POST /api/ai/weekly`（需登录）
- `GET /api/info`（公开，返回运行模式与访问地址）

除注册/登录/信息外，接口均需请求头 `Authorization: Bearer <token>`。

## 数据与安全
- 密码使用 Node 内置 scrypt 加盐哈希，不存明文
- 登录发放随机会话 token 存入数据库，用户之间数据按 `user_id` 隔离
- DeepSeek 密钥只在 Vercel 环境变量中，绝不出现在前端或代码库
- 数据库在 Turso 云端，Vercel 重启/重新部署数据不丢

## 项目结构
- `server.js`：全部后端逻辑，本地运行 + 导出 Vercel handler（双形态）
- `api/[...path].js`：Vercel Serverless 入口（转发到 server.js）
- `public/`：前端静态文件（Vercel 自动托管到根路径）
- `vercel.json`：Vercel 函数运行环境配置
- `render.yaml`：旧 Render 配置（如改用 Render 可参考，当前部署以 Vercel 为准）

## 常见问题
- **Vercel 部署后接口返回 500/提示配置**：在 Vercel 项目 Settings → Environment Variables 补 `TURSO_URL`、`TURSO_AUTH_TOKEN` 后 Redeploy
- **改代码后不生效**：确认已 `git push` 到 main 分支，Vercel 会自动重新部署
- **本地端口被占用**：`set PORT=4322` 后重新 `node server.js`
- **手机打不开**：本地模式需同一 Wi-Fi 并使用终端/页面底部显示的局域网地址；线上模式直接用 Vercel 网址即可
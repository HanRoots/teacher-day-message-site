# 致老师 · 教师节文字与语音留言

一个手机优先的教师节留言入口，并包含可播放语音的老师管理后台。

## 本地运行

```bash
npm run dev
```

- 留言入口：`http://localhost:4173/`
- 管理后台：`http://localhost:4173/admin`
- 本地开发默认后台密码：`teacher2026`

## 配置阿里云 OSS

复制 `.env.example` 中的变量到部署环境。项目使用“服务端签发 5 分钟上传凭证、浏览器直传 OSS”的方式，AccessKey Secret 不会发送给前端。

OSS Bucket 需配置 CORS：允许页面正式域名发起 `POST`，允许请求头 `Content-Type`，暴露 `ETag`。生产环境请使用权限最小化的 RAM 子账号，只授予 `teacher-day/*` 前缀的写入/读取权限。

若 `OSS_PRIVATE=true`，后台列表接口会为每段语音生成 10 分钟有效的播放地址。未配置 OSS 时，本地开发会把录音暂存在 `data/uploads`，便于完整体验流程。

## 发布到 GitHub Pages

仓库已包含 `.github/workflows/pages.yml`。推送到 `main` 分支后：

1. 在仓库 **Settings → Pages** 中将 Source 设为 **GitHub Actions**。
2. 在 **Settings → Secrets and variables → Actions → Variables** 新建 `API_BASE_URL`，填写已部署的 Node 服务地址，例如 `https://api.example.com`。
3. 在服务端设置 `FRONTEND_ORIGIN=https://你的用户名.github.io`（使用自定义域名时填写自定义域名）。

GitHub Pages 上的管理后台地址为站点根目录下的 `admin.html`。

前端可托管在 GitHub Pages；`server.js` 需要部署在支持 Node.js 与持久磁盘/数据库的云服务上。阿里云 ECS、轻量应用服务器或容器服务都适合，不能直接运行在 GitHub Pages。

## 部署提醒

- 必须设置强 `ADMIN_PASSWORD` 和至少 32 位随机 `SESSION_SECRET`。
- 当前留言元数据保存在 `data/messages.json`，适合单机轻量部署；多实例部署建议替换为数据库。
- 请使用 HTTPS；手机浏览器只有在 HTTPS 或 localhost 下才能请求麦克风权限。
- 默认单段录音最长 60 秒、最大 8MB，可通过 `MAX_AUDIO_BYTES` 调整。

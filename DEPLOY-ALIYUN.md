# 阿里云函数计算部署

后端采用阿里云函数计算 Web 函数（Custom Runtime），语音文件和留言索引均保存在 OSS。

## 1. 准备 OSS

创建或选择一个 Bucket，并为网页域名添加 CORS：

- 来源：`https://hanroots.github.io`
- 允许方法：`POST`、`GET`、`HEAD`
- 允许请求头：`*`
- 暴露响应头：`ETag`

为函数绑定一个 RAM 执行角色，并仅允许该角色访问当前 Bucket 下的：

- `teacher-day/*`

后端需要 `GetObject`、`PutObject` 权限；浏览器上传权限由后端签发的 5 分钟 Policy 限制。

## 2. 创建 Web 函数

在阿里云函数计算控制台创建 Web 函数：

- 运行环境：Custom Runtime
- 监听端口：`9000`
- 启动命令：`npm run start:fc`
- HTTP 触发器：允许匿名访问（API 自身保护管理接口）
- 允许请求方法：GET、POST、PATCH、OPTIONS

上传项目 ZIP 包后，绑定上述函数角色。函数计算会自动注入临时凭证，不需要保存长期 AccessKey。

然后配置以下环境变量：

```text
ADMIN_PASSWORD=后台强密码
SESSION_SECRET=至少32位随机字符串
FRONTEND_ORIGIN=https://hanroots.github.io
OSS_BUCKET=Bucket名称
OSS_REGION=oss-cn-hangzhou
OSS_PRIVATE=true
MAX_AUDIO_BYTES=8388608
```

不要把 AccessKey 写入源码、GitHub、函数环境变量或聊天消息。本地调试确有需要时，才使用 `.env` 中的 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` 和 `OSS_SECURITY_TOKEN`。

## 3. 连接 GitHub Pages

复制函数计算 HTTP 触发器公网地址。在 GitHub 仓库中进入：

`Settings → Secrets and variables → Actions → Variables`

新建仓库变量：

```text
API_BASE_URL=https://你的函数计算公网地址
```

然后重新运行 `Deploy frontend to GitHub Pages` 工作流。线上前端会自动连接该后端。

## 4. 验证

```bash
curl https://你的函数计算公网地址/api/health
```

正确返回应包含：

```json
{"ok":true,"oss":true}
```

之后用手机录制一段语音并提交，再打开 `admin.html` 登录确认可以播放。

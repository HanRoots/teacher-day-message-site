const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'messages.json');
const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES || 8 * 1024 * 1024);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'teacher2026');
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? '' : 'local-dev-session-secret-change-me');

if (IS_PRODUCTION && (!ADMIN_PASSWORD || !SESSION_SECRET)) {
  throw new Error('生产环境必须配置 ADMIN_PASSWORD 和 SESSION_SECRET');
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'audio/webm',
  '.mp4': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav'
};

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(res.req), ...headers });
  res.end(JSON.stringify(value));
}

function readBody(req, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求内容过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const body = await readBody(req);
  try { return JSON.parse(body.toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('JSON 格式错误'), { status: 400 }); }
}

function readMessages() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function writeMessages(messages) {
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(messages, null, 2));
  fs.renameSync(temp, DATA_FILE);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function makeSession() {
  const expires = Date.now() + 12 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ role: 'admin', expires })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function isAdmin(req) {
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)teacher_session=([^;]+)/);
  const token = bearer || (match ? decodeURIComponent(match[1]) : '');
  if (!token || !SESSION_SECRET) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return session.role === 'admin' && session.expires > Date.now();
  } catch { return false; }
}

function ossConfig() {
  const accessId = process.env.OSS_ACCESS_KEY_ID;
  const secret = process.env.OSS_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET;
  const region = process.env.OSS_REGION || 'oss-cn-hangzhou';
  const endpoint = (process.env.OSS_ENDPOINT || `https://${region}.aliyuncs.com`).replace(/\/$/, '');
  if (!accessId || !secret || !bucket) return null;
  const endpointHost = endpoint.replace(/^https?:\/\//, '');
  return { accessId, secret, bucket, region, endpoint, host: `https://${bucket}.${endpointHost}` };
}

function createOssUploadPolicy(contentType = 'audio/webm') {
  const config = ossConfig();
  if (!config) return { enabled: false };
  const extensionMap = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };
  const extension = extensionMap[contentType] || 'webm';
  const day = new Date().toISOString().slice(0, 10);
  const prefix = `teacher-day/${day}/`;
  const key = `${prefix}${crypto.randomUUID()}.${extension}`;
  const policyObject = {
    expiration: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    conditions: [
      ['content-length-range', 1, MAX_AUDIO_BYTES],
      ['starts-with', '$key', prefix],
      ['starts-with', '$Content-Type', 'audio/']
    ]
  };
  const policy = Buffer.from(JSON.stringify(policyObject)).toString('base64');
  const signature = crypto.createHmac('sha1', config.secret).update(policy).digest('base64');
  return {
    enabled: true,
    host: config.host,
    key,
    accessId: config.accessId,
    policy,
    signature,
    publicUrl: `${config.host}/${key}`
  };
}

function signedAudioUrl(key, fallbackUrl) {
  const config = ossConfig();
  if (!config || !key || process.env.OSS_PRIVATE !== 'true') return fallbackUrl;
  const expires = Math.floor(Date.now() / 1000) + 600;
  const resource = `/${config.bucket}/${key}`;
  const signature = crypto.createHmac('sha1', config.secret).update(`GET\n\n\n${expires}\n${resource}`).digest('base64');
  return `${config.host}/${key}?OSSAccessKeyId=${encodeURIComponent(config.accessId)}&Expires=${expires}&Signature=${encodeURIComponent(signature)}`;
}

function sanitizeText(value, max) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
}

function corsHeaders(req) {
  if (!req) return {};
  const configured = String(process.env.FRONTEND_ORIGIN || '').split(',').map(item => item.trim()).filter(Boolean);
  const origin = String(req.headers.origin || '');
  const allowOrigin = configured.includes(origin) ? origin : (!IS_PRODUCTION && origin ? origin : '');
  if (!allowOrigin) return {};
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  };
}

function serveFile(req, res, pathname) {
  let relative = pathname === '/' ? 'index.html' : pathname === '/admin' ? 'admin.html' : pathname.replace(/^\//, '');
  let base = PUBLIC_DIR;
  if (relative.startsWith('uploads/')) {
    base = path.join(ROOT, 'data');
  }
  const filePath = path.resolve(base, relative);
  if (!filePath.startsWith(path.resolve(base))) return json(res, 403, { error: '禁止访问' });
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) return json(res, 404, { error: '页面不存在' });
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': relative.endsWith('.html') ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  res.req = req;
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(req),
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, oss: Boolean(ossConfig()) });
    }

    if (req.method === 'POST' && url.pathname === '/api/oss/policy') {
      const body = await readJson(req);
      const type = String(body.contentType || 'audio/webm');
      if (!type.startsWith('audio/')) return json(res, 400, { error: '仅支持音频文件' });
      return json(res, 200, createOssUploadPolicy(type));
    }

    if (req.method === 'POST' && url.pathname === '/api/audio') {
      const contentType = String(req.headers['content-type'] || '');
      if (!contentType.startsWith('audio/')) return json(res, 415, { error: '仅支持音频文件' });
      const buffer = await readBody(req, MAX_AUDIO_BYTES);
      const extension = contentType.includes('mp4') ? 'm4a' : contentType.includes('ogg') ? 'ogg' : contentType.includes('wav') ? 'wav' : 'webm';
      const fileName = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
      return json(res, 201, { audioUrl: `/uploads/${fileName}`, audioKey: null, storage: 'local-demo' });
    }

    if (req.method === 'POST' && url.pathname === '/api/messages') {
      const body = await readJson(req);
      const teacher = sanitizeText(body.teacher, 40);
      const message = sanitizeText(body.message, 500);
      const sender = sanitizeText(body.sender, 40);
      const audioUrl = sanitizeText(body.audioUrl, 1000);
      const audioKey = sanitizeText(body.audioKey, 500);
      const duration = Math.max(0, Math.min(60, Number(body.duration) || 0));
      if (!teacher) return json(res, 400, { error: '请填写老师的称呼' });
      if (!message && !audioUrl) return json(res, 400, { error: '请写一句祝福，或录一段话' });
      const messages = readMessages();
      const record = {
        id: crypto.randomUUID(), teacher, message, sender, audioUrl, audioKey,
        duration: Math.round(duration), listened: false, createdAt: new Date().toISOString()
      };
      messages.unshift(record);
      writeMessages(messages.slice(0, 5000));
      return json(res, 201, { ok: true, id: record.id });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const body = await readJson(req);
      if (!ADMIN_PASSWORD || !safeEqual(body.password || '', ADMIN_PASSWORD)) {
        return json(res, 401, { error: '密码不正确' });
      }
      const cookie = `teacher_session=${encodeURIComponent(makeSession())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${IS_PRODUCTION ? '; Secure' : ''}`;
      return json(res, 200, { ok: true, token: makeSession() }, { 'Set-Cookie': cookie });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'teacher_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
    }

    if (url.pathname.startsWith('/api/admin/') && !isAdmin(req)) {
      return json(res, 401, { error: '请先登录' });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/messages') {
      const messages = readMessages().map(item => ({
        ...item,
        playbackUrl: item.audioUrl ? signedAudioUrl(item.audioKey, item.audioUrl) : ''
      }));
      return json(res, 200, { messages });
    }

    const messageMatch = url.pathname.match(/^\/api\/admin\/messages\/([a-f0-9-]+)$/i);
    if (req.method === 'PATCH' && messageMatch) {
      const body = await readJson(req);
      const messages = readMessages();
      const record = messages.find(item => item.id === messageMatch[1]);
      if (!record) return json(res, 404, { error: '留言不存在' });
      if (typeof body.listened === 'boolean') record.listened = body.listened;
      writeMessages(messages);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET') return serveFile(req, res, url.pathname);
    return json(res, 404, { error: '接口不存在' });
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '服务器暂时开小差了' });
  }
});

server.listen(PORT, () => {
  console.log(`教师节留言页：http://localhost:${PORT}`);
  console.log(`留言管理后台：http://localhost:${PORT}/admin`);
  if (!ossConfig()) console.log('提示：OSS 未配置，录音将暂存本机 data/uploads 目录。');
  if (!IS_PRODUCTION) console.log('本地后台默认密码：teacher2026');
});

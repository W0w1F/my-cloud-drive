// server.js — API Gateway: Frontend ↔ MySQL Stored Procedures
// Constitution: IV (drive_app minimal privilege), VI (SP encapsulation)
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();

// ============================================================================
// Configuration (from environment variables with secure defaults)
// ============================================================================
const CONFIG = {
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_USER: process.env.DB_USER || 'drive_app',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'cloud_drive',
  DB_CONNECTION_LIMIT: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  API_PORT: parseInt(process.env.API_PORT, 10) || 8081,
  UPLOAD_MAX_SIZE: parseInt(process.env.UPLOAD_MAX_SIZE, 10) || 10 * 1024 * 1024 * 1024,
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:8081',
};

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'blocks');
const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend', 'src');

// Reject executable and dangerous file types
const BLOCKED_EXTENSIONS = /\.(exe|sh|bat|cmd|com|msi|dll|so|vbs|ps1|scr|pif|reg|cpl|app|dmg|apk)$/i;

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: CONFIG.UPLOAD_MAX_SIZE },
  fileFilter: function(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.test(ext)) {
      cb(new Error('不支持上传可执行文件类型：' + ext), false);
    } else {
      cb(null, true);
    }
  }
});

// Ensure directories exist
[UPLOAD_DIR, STORAGE_DIR].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

if (!CONFIG.DB_PASSWORD) {
  console.warn('[WARN] DB_PASSWORD is empty — database connection will fail. Set it in .env');
}

if (!CONFIG.JWT_SECRET) {
  console.warn('[WARN] JWT_SECRET is empty — authentication will be insecure. Set it in .env');
}

// ============================================================================
// MySQL Pool — drive_app (Constitution IV: Least Privilege)
// ============================================================================
const pool = mysql.createPool({
  host: CONFIG.DB_HOST,
  user: CONFIG.DB_USER,
  password: CONFIG.DB_PASSWORD,
  database: CONFIG.DB_NAME,
  waitForConnections: true,
  connectionLimit: CONFIG.DB_CONNECTION_LIMIT,
});

// ============================================================================
// CORS — strict origin validation with multi-origin support
// ============================================================================
const ALLOWED_ORIGINS = CONFIG.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);

const corsOptions = {
  origin: function(origin, cb) {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.use(express.json());

// ============================================================================
// Rate Limiting — protect against brute force and abuse
// ============================================================================
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: '登录/注册请求过于频繁，请稍后再试' } },
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: '上传请求过于频繁，请稍后再试' } },
});

const CSP_HEADER = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;";

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP_HEADER);
  next();
});

// Serve frontend static files (login page, CSS, JS — no auth needed for these)
app.use(express.static(FRONTEND_DIR));

// ============================================================================
// Authentication Routes (before JWT middleware — public, strict rate limit)
// ============================================================================

// POST /api/v1/auth/register — Create user account
app.post('/api/v1/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '需要用户名和密码' } });
    }
    if (username.length < 2 || username.length > 64) {
      return res.status(400).json({ error: { code: 'INVALID_USERNAME', message: '用户名长度需在 2-64 位之间' } });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: { code: 'WEAK_PASSWORD', message: '密码长度至少 8 位' } });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: { code: 'WEAK_PASSWORD', message: '密码长度不能超过 128 位' } });
    }
    // Require at least one letter and one digit
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: { code: 'WEAK_PASSWORD', message: '密码必须包含字母和数字' } });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const [result] = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)',
        [username.trim(), passwordHash]
      );
      res.status(201).json({ id: result.insertId, username: username.trim() });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: { code: 'USER_EXISTS', message: '用户名已存在' } });
      }
      throw err;
    }
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/auth/register', status: 500, message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// POST /api/v1/auth/login — Authenticate and return JWT
app.post('/api/v1/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '需要用户名和密码' } });
    }

    const [rows] = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      [username.trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: '用户名或密码错误' } });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: { code: 'AUTH_FAILED', message: '用户名或密码错误' } });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      CONFIG.JWT_SECRET,
      { expiresIn: CONFIG.JWT_EXPIRES_IN }
    );

    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/auth/login', status: 500, message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ============================================================================
// JWT Authentication Middleware — applied to all /api/v1/* below
// ============================================================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '未提供认证令牌' } });
  }

  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET);
    req.operatorId = decoded.userId;
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: { code: 'TOKEN_EXPIRED', message: '令牌已过期，请重新登录' } });
    }
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: '无效的认证令牌' } });
  }
}

// Apply auth middleware + rate limiting to all /api/v1 routes except /auth/* and /health
app.use('/api', generalLimiter, (req, res, next) => {
  if (req.path.startsWith('/v1/auth') || req.path.startsWith('/v1/health')) return next();
  authenticateToken(req, res, next);
});

// ============================================================================
// 1. GET /api/v1/tree — Directory tree
// ============================================================================
app.get('/api/v1/tree', async (req, res) => {
  try {
    const { parent_id } = req.query;
    const [rows] = await pool.query(
      `SELECT fn.id, fn.name, fn.type, fn.size, fn.parent_id, fn.modified_at, fn.status,
              (SELECT COUNT(*) FROM file_nodes child WHERE child.parent_id = fn.id AND child.status = 'active') AS child_count,
              CASE WHEN EXISTS (SELECT 1 FROM file_nodes child WHERE child.parent_id = fn.id AND child.status = 'active') THEN TRUE ELSE FALSE END AS has_children
       FROM file_nodes fn
       WHERE fn.parent_id ${parent_id ? '= ?' : 'IS NULL'}
         AND fn.owner_id = ?
         AND fn.status = 'active'
       ORDER BY fn.type ASC, fn.name ASC`,
      parent_id ? [parent_id, req.operatorId] : [req.operatorId]
    );
    res.json({ nodes: rows });
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/tree', status: 500, message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ============================================================================
// 2. GET /api/v1/files — File list (grid)
// ============================================================================
app.get('/api/v1/files', async (req, res) => {
  try {
    const { parent_id, offset = 0, limit = 50 } = req.query;
    const params = [req.operatorId];

    let whereClause = 'WHERE fn.status = \'active\' AND fn.owner_id = ?';
    if (parent_id) {
      whereClause += ' AND fn.parent_id = ?';
      params.push(parent_id);
    } else {
      whereClause += ' AND fn.parent_id IS NULL';
    }

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM file_nodes fn ${whereClause}`, params);
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT fn.id, fn.name, fn.type, fn.size, fn.hash, fn.parent_id, fn.modified_at, fn.status,
              CASE WHEN fn.type = 'file' AND LOWER(SUBSTRING_INDEX(fn.name, '.', -1)) IN ('jpg','jpeg','png','gif','webp','svg','bmp')
                   THEN CONCAT('/api/v1/thumb/', fn.id) ELSE NULL END AS thumbnail_url
       FROM file_nodes fn ${whereClause}
       ORDER BY fn.type ASC, fn.name ASC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    res.json({ items: rows, total, offset: parseInt(offset), limit: parseInt(limit) });
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/files', status: 500, message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ============================================================================
// 3. POST /api/v1/files/upload — File upload with dedup (Constitution II, VI)
// ============================================================================
app.post('/api/v1/files/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { parent_id } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'No file uploaded' } });

    var originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    // Sanitize filename — strip path traversal and control characters
    originalName = originalName.replace(/[/\\:\0]/g, '_').replace(/^\.+/, '');

    // Validate filename — reject empty or overly long names
    if (!originalName || originalName.length > 255) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: { code: 'INVALID_NAME', message: '文件名无效或过长' } });
    }

    // Compute SHA-1 hash via streaming (never loads file into memory)
    const fileSize = file.size;
    const hash = await new Promise((resolve, reject) => {
      const hasher = crypto.createHash('sha1');
      const readStream = fs.createReadStream(file.path);
      readStream.on('error', reject);
      hasher.on('error', reject);
      readStream.pipe(hasher);
      readStream.on('end', () => resolve(hasher.digest('hex')));
    });

    // Store physically under hash-based path
    const hashDir = path.join(STORAGE_DIR, hash.substring(0, 2), hash.substring(2, 4));
    fs.mkdirSync(hashDir, { recursive: true });
    const realPath = path.join(hashDir, hash);

    // Dedup check: move if new, delete temp if duplicate
    if (!fs.existsSync(realPath)) {
      fs.renameSync(file.path, realPath);
    } else {
      fs.unlinkSync(file.path);
    }

    // Call stored procedure (Constitution VI)
    const [rows] = await conn.query(
      'CALL sp_upload_file(?, ?, ?, ?, ?, ?)',
      [req.operatorId, parent_id ? parseInt(parent_id) : null, originalName, fileSize, hash, realPath]
    );

    const result = rows[0]?.[0] || rows[0];
    res.json(result);
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/files/upload', status: 500, message: err.message });
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: { code: 'UPLOAD_FAILED', message: err.message } });
  } finally {
    conn.release();
  }
});

// ============================================================================
// 4b. GET /api/v1/trash — List deleted files (recycle bin)
// (Must be before /api/v1/files/:id routes to avoid param conflict)
// ============================================================================
app.get('/api/v1/trash', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, type, size, modified_at, status
       FROM file_nodes
       WHERE owner_id = ? AND status = 'deleted'
       ORDER BY modified_at DESC`,
      [req.operatorId]
    );
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/trash', message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ============================================================================
// 4a. GET /api/v1/files/:id/preview — File content preview
// ============================================================================
app.get('/api/v1/files/:id/preview', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT fn.name, fn.size, fn.type, pb.real_path
       FROM file_nodes fn
       JOIN physical_blocks pb ON fn.hash = pb.sha1_hash
       WHERE fn.id = ? AND fn.type = 'file' AND fn.status = 'active'`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
    const { name, size, real_path } = rows[0];
    if (!fs.existsSync(real_path)) return res.status(500).json({ error: { code: 'BLOCK_MISSING', message: '文件数据不可用' } });

    var ext = name.split('.').pop().toLowerCase();
    var textExts = ['md','txt','json','js','css','html','xml','py','sql','sh','yml','yaml','c','cpp','h','java','ts','jsx','tsx','ini','cfg','log','csv'];
    var imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp'];

    if (textExts.includes(ext) && size < 5 * 1024 * 1024) {
      var content = fs.readFileSync(real_path, 'utf8');
      res.json({ type: 'text', name: name, content: content, size: size });
    } else if (imgExts.includes(ext)) {
      res.json({ type: 'image', name: name, size: size, url: '/api/v1/files/' + req.params.id + '/download' });
    } else {
      res.json({ type: 'binary', name: name, size: size, ext: ext });
    }
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/files/preview', message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ============================================================================
// 4. GET /api/v1/files/:id/download — File download
// ============================================================================
app.get('/api/v1/files/:id/download', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT fn.name, fn.size, pb.real_path
       FROM file_nodes fn
       JOIN physical_blocks pb ON fn.hash = pb.sha1_hash
       WHERE fn.id = ? AND fn.type = 'file' AND fn.status = 'active'`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'File not found' } });
    const { name, size, real_path } = rows[0];

    if (!fs.existsSync(real_path)) {
      console.error('[API_ERROR]', { endpoint: '/files/download', status: 500, message: 'BLOCK_MISSING', nodeId: req.params.id });
      return res.status(500).json({ error: { code: 'BLOCK_MISSING', message: '文件数据不可用' } });
    }

    const ext = path.extname(name).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf', '.json': 'application/json',
      '.txt': 'text/plain', '.html': 'text/html', '.css': 'text/css',
      '.js': 'application/javascript', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
      '.zip': 'application/zip', '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    // Range support (RFC 7233) — enables resumable downloads and video seeking
    const range = req.headers['range'];
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

      if (start >= size || end >= size || start > end) {
        res.setHeader('Content-Range', 'bytes */' + size);
        return res.status(416).end();
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(name) + '"; filename*=UTF-8\'\'' + encodeURIComponent(name));
      fs.createReadStream(real_path, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(name) + '"; filename*=UTF-8\'\'' + encodeURIComponent(name));
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', size);
    fs.createReadStream(real_path).pipe(res);
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/files/download', status: 500, message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ============================================================================
// 5. GET /api/v1/files/search — Full-text search (FULLTEXT with LIKE fallback)
// ============================================================================
app.get('/api/v1/files/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ items: [], total: 0 });

    // FULLTEXT BOOLEAN MODE: add wildcard suffix to each word for prefix matching
    const ftQuery = q.trim().split(/\s+/).map(w => '+' + w.replace(/[+\-<>()~*\"@]/g, '') + '*').join(' ');

    let rows;
    try {
      [rows] = await pool.query(
        `SELECT id, name, type, size, hash, parent_id, modified_at, status,
                MATCH(name) AGAINST(? IN BOOLEAN MODE) AS relevance
         FROM file_nodes
         WHERE MATCH(name) AGAINST(? IN BOOLEAN MODE)
           AND owner_id = ? AND status = 'active'
         ORDER BY relevance DESC, type ASC, name ASC
         LIMIT 50`,
        [ftQuery, ftQuery, req.operatorId]
      );
    } catch (err) {
      // FULLTEXT index may not exist — fall back to LIKE
      rows = [];
    }

    // Fallback to LIKE if FULLTEXT returned no results or not available
    if (rows.length === 0) {
      const keyword = `%${q.replace(/\*/g, '%')}%`;
      [rows] = await pool.query(
        `SELECT id, name, type, size, hash, parent_id, modified_at, status FROM file_nodes
         WHERE name LIKE ? AND owner_id = ? AND status = 'active'
         ORDER BY type ASC, name ASC LIMIT 50`,
        [keyword, req.operatorId]
      );
    }

    res.json({ items: rows, total: rows.length, offset: 0, limit: 50 });
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/files/search', status: 500, message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ============================================================================
// 6. POST /api/v1/files/:id/delete — Soft delete
// ============================================================================
app.post('/api/v1/files/:id/delete', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET @current_operator_id = ?', [req.operatorId]);
    const [rows] = await conn.query('CALL sp_soft_delete_node(?, ?)', [parseInt(req.params.id), req.operatorId]);
    res.json(rows[0]?.[0] || rows[0]);
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/files/delete', status: 500, message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  } finally { conn.release(); }
});

// ============================================================================
// 7. POST /api/v1/files/:id/restore — Restore
// ============================================================================
app.post('/api/v1/files/:id/restore', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET @current_operator_id = ?', [req.operatorId]);
    const [rows] = await conn.query('CALL sp_restore_node(?, ?)', [parseInt(req.params.id), req.operatorId]);
    res.json(rows[0]?.[0] || rows[0]);
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/files/restore', status: 500, message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  } finally { conn.release(); }
});

// ============================================================================
// 8. POST /api/v1/files/:id/move — Move file/directory
// ============================================================================
app.post('/api/v1/files/:id/move', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET @current_operator_id = ?', [req.operatorId]);
    const { new_parent_id } = req.body;
    const [rows] = await conn.query('CALL sp_move_node(?, ?, ?)', [parseInt(req.params.id), new_parent_id || null, req.operatorId]);
    res.json(rows[0]?.[0] || rows[0]);
  } catch (err) {
    const code = err.message.includes('CYCLE_DETECTED') ? 'CYCLE_DETECTED' : 'INTERNAL';
    const status = code === 'CYCLE_DETECTED' ? 400 : 500;
    console.error('[API_ERROR]', { endpoint: '/files/move', status, message: err.message });
    res.status(status).json({ error: { code, message: err.message } });
  } finally { conn.release(); }
});

// ============================================================================
// 9. POST /api/v1/directories — Create directory
// ============================================================================
app.post('/api/v1/directories', async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: { code: 'INVALID_NAME', message: 'Directory name required' } });

    const [existing] = await pool.query(
      'SELECT id FROM file_nodes WHERE name = ? AND parent_id <=> ? AND owner_id = ? AND status = \'active\'',
      [name.trim(), parent_id || null, req.operatorId]
    );
    if (existing.length > 0) return res.status(409).json({ error: { code: 'DUPLICATE_NAME', message: '同名目录已存在' } });

    const [result] = await pool.query(
      'INSERT INTO file_nodes (name, type, size, hash, parent_id, owner_id) VALUES (?, \'directory\', 0, NULL, ?, ?)',
      [name.trim(), parent_id || null, req.operatorId]
    );

    res.json({ id: result.insertId, name: name.trim(), type: 'directory', size: 0, parent_id: parent_id || null, status: 'active' });
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/directories', status: 500, message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ============================================================================
// 10a. GET /api/v1/files/:id/path — Full directory path
// ============================================================================
app.get('/api/v1/files/:id/path', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT fn_get_node_full_path(?) AS path', [parseInt(req.params.id)]);
    res.json(rows[0] || { path: '' });
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/files/path', message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ============================================================================
// POST /api/v1/trash/restore-all — Batch restore all deleted files
// ============================================================================
app.post('/api/v1/trash/restore-all', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id FROM file_nodes WHERE owner_id = ? AND status = 'deleted'`,
      [req.operatorId]
    );
    let restored = 0;
    let errors = 0;
    for (const row of rows) {
      try {
        await pool.query('CALL sp_restore_node(?, ?)', [row.id, req.operatorId]);
        restored++;
      } catch (err) {
        errors++;
        console.error('[RESTORE_BATCH_ERROR]', { nodeId: row.id, error: err.message });
      }
    }
    res.json({ restored_count: restored, error_count: errors, total: rows.length });
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/trash/restore-all', message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// 10a. DELETE /api/v1/trash/clear — Permanently clear trash + cleanup orphan blocks
// ============================================================================
app.delete('/api/v1/trash/clear', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('CALL sp_clear_trash(?)', [req.operatorId]);
    const deletedCount = rows[0]?.[0]?.deleted_count || 0;

    // Find orphan physical blocks (ref_count = 0) and delete disk files
    const [orphans] = await conn.query(
      'SELECT sha1_hash, real_path FROM physical_blocks WHERE ref_count = 0'
    );

    let orphanCount = 0;
    for (const block of orphans) {
      if (block.real_path && fs.existsSync(block.real_path)) {
        try {
          fs.unlinkSync(block.real_path);
          orphanCount++;

          // Clean up empty parent directories (hash/ab/cd/ → hash/ → remove)
          const dir2 = path.dirname(block.real_path);
          const dir1 = path.dirname(dir2);
          try { fs.rmdirSync(dir2); } catch (e) { /* not empty */ }
          try { fs.rmdirSync(dir1); } catch (e) { /* not empty */ }
        } catch (e) {
          console.error('[CLEANUP_ERROR]', { hash: block.sha1_hash, path: block.real_path, error: e.message });
        }
      }
    }

    // Remove orphan physical_blocks records
    const [delResult] = await conn.query('DELETE FROM physical_blocks WHERE ref_count = 0');

    res.json({
      deleted_count: deletedCount,
      storage_freed: orphanCount,
      message: orphanCount > 0
        ? '已清理 ' + orphanCount + ' 个物理文件，释放存储空间'
        : '回收站已清空'
    });
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/trash/clear', message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  } finally { conn.release(); }
});

// ============================================================================
// 10. PATCH /api/v1/files/:id — Rename
// ============================================================================
app.patch('/api/v1/files/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: { code: 'INVALID_NAME', message: 'Name required' } });

    // Verify ownership before renaming
    const [owned] = await conn.query('SELECT id FROM file_nodes WHERE id = ? AND owner_id = ?', [parseInt(req.params.id), req.operatorId]);
    if (owned.length === 0) return res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'Node not found' } });

    await conn.query('SET @current_operator_id = ?', [req.operatorId]);
    await conn.query('UPDATE file_nodes SET name = ?, modified_at = NOW() WHERE id = ?', [name.trim(), parseInt(req.params.id)]);

    const [rows] = await conn.query('SELECT id, name, type, size, hash, parent_id, modified_at, status FROM file_nodes WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'Node not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/files/rename', status: 500, message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  } finally { conn.release(); }
});

// ============================================================================
// GET /api/v1/thumb/:id — Thumbnail proxy (image files only)
// ============================================================================
app.get('/api/v1/thumb/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT fn.hash, pb.real_path FROM file_nodes fn JOIN physical_blocks pb ON fn.hash = pb.sha1_hash WHERE fn.id = ?',
      [req.params.id]
    );
    if (rows.length === 0 || !fs.existsSync(rows[0].real_path)) {
      return res.status(404).end();
    }
    res.sendFile(rows[0].real_path);
  } catch (err) { res.status(500).end(); }
});

// ============================================================================
// ============================================================================
// GET /api/v1/health — Health check (no auth required)
// ============================================================================
app.get('/api/v1/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS db_ok');
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'disconnected', error: err.message });
  }
});

// API 404 for unmatched /api/ routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
});

// Multer/upload error handler
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: '文件大小超过限制' } });
  }
  if (err.message && err.message.startsWith('不支持上传')) {
    return res.status(400).json({ error: { code: 'BLOCKED_TYPE', message: err.message } });
  }
  console.error('[UNHANDLED_ERROR]', { message: err.message, stack: err.stack });
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
});

// ============================================================================
// Start
// ============================================================================
const PORT = CONFIG.API_PORT;
const server = app.listen(PORT, () => {
  console.log(`Cloud Drive API running on http://localhost:${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
  console.log(`MySQL: ${CONFIG.DB_USER}@${CONFIG.DB_HOST}/${CONFIG.DB_NAME}`);
});

// ============================================================================
// Graceful Shutdown — close server and pool on SIGTERM/SIGINT
// ============================================================================
function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}, closing server...`);
  server.close(async () => {
    console.log('[SHUTDOWN] HTTP server closed');
    try {
      await pool.end();
      console.log('[SHUTDOWN] MySQL pool closed');
    } catch (e) {
      console.error('[SHUTDOWN] Error closing pool:', e.message);
    }
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => { console.error('[SHUTDOWN] Forced exit'); process.exit(1); }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

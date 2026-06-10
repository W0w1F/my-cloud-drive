// server.js — API Gateway: Frontend ↔ MySQL Stored Procedures
// Constitution: IV (drive_app minimal privilege), VI (SP encapsulation)
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads'), limits: { fileSize: 10 * 1024 * 1024 * 1024 } }); // 10GB
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'blocks');

// Ensure directories exist
[UPLOAD_DIR, STORAGE_DIR].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

// ============================================================================
// MySQL Pool — drive_app (Constitution IV: Least Privilege)
// ============================================================================
const pool = mysql.createPool({
  host: 'localhost',
  user: 'drive_app',
  password: 'CHANGE_ME_APP_PASSWORD',
  database: 'cloud_drive',
  waitForConnections: true,
  connectionLimit: 10,
});

// ============================================================================
// Middleware
// ============================================================================
app.use(cors());
app.use(express.json());

const CSP_HEADER = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;";

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP_HEADER);
  next();
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', '..', 'frontend', 'src')));

// Extract operator_id from request or default to 1 (v1: hardcoded user)
app.use((req, res, next) => {
  req.operatorId = req.body?.operator_id || req.headers['x-operator-id'] || 1;
  next();
});

// ============================================================================
// 1. GET /api/v1/tree — Directory tree
// ============================================================================
app.get('/api/v1/tree', async (req, res) => {
  try {
    const { parent_id, owner_id } = req.query;
    const [rows] = await pool.query(
      `SELECT fn.id, fn.name, fn.type, fn.size, fn.parent_id, fn.modified_at, fn.status,
              (SELECT COUNT(*) FROM file_nodes child WHERE child.parent_id = fn.id AND child.status = 'active') AS child_count,
              CASE WHEN EXISTS (SELECT 1 FROM file_nodes child WHERE child.parent_id = fn.id AND child.status = 'active') THEN TRUE ELSE FALSE END AS has_children
       FROM file_nodes fn
       WHERE fn.parent_id ${parent_id ? '= ?' : 'IS NULL'}
         AND fn.owner_id = ?
         AND fn.status = 'active'
       ORDER BY fn.type ASC, fn.name ASC`,
      parent_id ? [parent_id, owner_id || 1] : [owner_id || 1]
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
    const { parent_id, owner_id, offset = 0, limit = 50 } = req.query;
    const params = owner_id ? [owner_id] : [1];

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
              CASE WHEN fn.type = 'file' AND fn.hash IN (SELECT sha1_hash FROM physical_blocks WHERE real_path LIKE '%.jpg' OR real_path LIKE '%.png' OR real_path LIKE '%.gif' OR real_path LIKE '%.webp')
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
app.post('/api/v1/files/upload', upload.single('file'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { parent_id, owner_id } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'No file uploaded' } });

    // Fix Chinese filename encoding from multer
    var originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    // Compute SHA-1 hash (Constitution II)
    const fileBuffer = fs.readFileSync(file.path);
    const hash = crypto.createHash('sha1').update(fileBuffer).digest('hex');
    const fileSize = fileBuffer.length;

    // Store physically under hash-based path
    const hashDir = path.join(STORAGE_DIR, hash.substring(0, 2), hash.substring(2, 4));
    fs.mkdirSync(hashDir, { recursive: true });
    const realPath = path.join(hashDir, hash);

    // Only write if not already exists (dedup)
    if (!fs.existsSync(realPath)) {
      fs.writeFileSync(realPath, fileBuffer);
    }

    // Clean up temp upload
    fs.unlinkSync(file.path);

    // Call stored procedure (Constitution VI)
    const [rows] = await conn.query(
      'CALL sp_upload_file(?, ?, ?, ?, ?, ?)',
      [parseInt(owner_id) || 1, parent_id ? parseInt(parent_id) : null, originalName, fileSize, hash, realPath]
    );

    // MySQL stored procedure returns multiple result sets; the first one has our data
    const result = rows[0]?.[0] || rows[0];
    res.json(result);
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/files/upload', status: 500, message: err.message });
    // Cleanup temp file on error
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
    const { owner_id } = req.query;
    const [rows] = await pool.query(
      `SELECT id, name, type, size, modified_at, status
       FROM file_nodes
       WHERE owner_id = ? AND status = 'deleted'
       ORDER BY modified_at DESC`,
      [owner_id || 1]
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

    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(name) + '"; filename*=UTF-8\'\'' + encodeURIComponent(name));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', size);
    fs.createReadStream(real_path).pipe(res);
  } catch (err) {
    console.error('[API_ERROR]', { endpoint: '/files/download', status: 500, message: err.message });
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
});

// ============================================================================
// 5. GET /api/v1/files/search — Fuzzy search
// ============================================================================
app.get('/api/v1/files/search', async (req, res) => {
  try {
    const { q, owner_id } = req.query;
    if (!q) return res.json({ items: [], total: 0 });

    const keyword = `%${q.replace(/\*/g, '%')}%`;
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM file_nodes WHERE name LIKE ? AND owner_id = ? AND status = 'active'`,
      [keyword, owner_id || 1]
    );

    const [rows] = await pool.query(
      `SELECT id, name, type, size, hash, parent_id, modified_at, status FROM file_nodes
       WHERE name LIKE ? AND owner_id = ? AND status = 'active'
       ORDER BY type ASC, name ASC LIMIT 50`,
      [keyword, owner_id || 1]
    );

    res.json({ items: rows, total: countRows[0].total, offset: 0, limit: 50 });
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
    const { name, parent_id, owner_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: { code: 'INVALID_NAME', message: 'Directory name required' } });

    // Check duplicate
    const [existing] = await pool.query(
      'SELECT id FROM file_nodes WHERE name = ? AND parent_id <=> ? AND owner_id = ? AND status = \'active\'',
      [name.trim(), parent_id || null, owner_id || 1]
    );
    if (existing.length > 0) return res.status(409).json({ error: { code: 'DUPLICATE_NAME', message: '同名目录已存在' } });

    const [result] = await pool.query(
      'INSERT INTO file_nodes (name, type, size, hash, parent_id, owner_id) VALUES (?, \'directory\', 0, NULL, ?, ?)',
      [name.trim(), parent_id || null, owner_id || 1]
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
// 10a. DELETE /api/v1/trash/clear — Permanently clear trash
// ============================================================================
app.delete('/api/v1/trash/clear', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { owner_id } = req.body;
    const [rows] = await conn.query('CALL sp_clear_trash(?)', [owner_id || 1]);
    res.json({ deleted_count: rows[0]?.[0]?.deleted_count || 0 });
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
// API 404 for unmatched /api/ routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
});

// ============================================================================
// Start
// ============================================================================
const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(`Cloud Drive API running on http://localhost:${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
  console.log(`MySQL: drive_app@localhost/cloud_drive`);
});

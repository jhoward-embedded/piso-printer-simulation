const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cors = require('cors');
const { exec } = require('child_process');
const { PDFDocument } = require('pdf-lib');

const MAX_LOGS = 1000;
const logs = [];

function captureLog(type, ...args) {
  const timestamp = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  logs.push({ timestamp, type, message });
  if (logs.length > MAX_LOGS) logs.shift();
}

const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

console.log = function(...args) {
  captureLog('LOG', ...args);
  origLog.apply(console, args);
};
console.warn = function(...args) {
  captureLog('WARN', ...args);
  origWarn.apply(console, args);
};
console.error = function(...args) {
  captureLog('ERROR', ...args);
  origError.apply(console, args);
};

const SERVER_START_TIME = Date.now();
const CONFIG_FILE = path.join(__dirname, 'config.json');
const DATA_FILE = path.join(__dirname, 'data.json');

const defaultConfig = {
  logo: '/logo.png',
  background: '/bg-pattern.png',
  outerBackground: '#0a1628',
  icon: 'fa-print',
  printerImage: 'https://pngimg.com/uploads/printer/printer_PNG101566.png',
  adminUser: 'admin',
  adminPassword: 'admin'
};

function getConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE);
      return JSON.parse(raw);
    }
  } catch (e) {}
  return { ...defaultConfig };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getAdminCredentials() {
  const cfg = getConfig();
  return {
    username: cfg.adminUser || 'admin',
    password: cfg.adminPassword || 'admin'
  };
}

const CONFIG = {
  PORT: process.env.PORT || 3000,
  SESSION_EXPIRY_SEC: 600,
  MAX_FILE_SIZE: 15 * 1024 * 1024,
  PRICE_PER_PAGE: 1.00,
  COLOR_EXTRA: 2.00,
  A4_EXTRA: 0.00,
  LEGAL_EXTRA: 1.00
};

const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PRINT_QUEUE = path.join(__dirname, 'print-queue');

[PUBLIC_DIR, UPLOAD_DIR, PRINT_QUEUE].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const sessions = new Map();

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: CONFIG.MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
    cb(null, allowed.includes(ext));
  }
});

// Admin Basic Auth middleware
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).json({ error: 'Auth required' });
  }
  const base64 = auth.split(' ')[1];
  const [user, pass] = Buffer.from(base64, 'base64').toString().split(':');
  const creds = getAdminCredentials();
  if (user === creds.username && pass === creds.password) return next();
  res.status(403).json({ error: 'Invalid credentials' });
}

// Public endpoint to verify credentials (for login page)
app.post('/api/auth', (req, res) => {
  const { username, password } = req.body;
  const creds = getAdminCredentials();
  if (username === creds.username && password === creds.password) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

async function getPageCount(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const pdf = await PDFDocument.load(data, { ignoreEncryption: true });
    const pages = pdf.getPageCount();
    console.log(`[PDF] Page count: ${pages}`);
    return pages;
  } catch (err) {
    console.error('[PDF] Error:', err.message);
    try {
      const buffer = fs.readFileSync(filePath);
      const str = buffer.toString('latin1');
      const matches = str.match(/\/Type\s*\/Page\b/g);
      if (matches && matches.length > 0) {
        console.log(`[PDF] Fallback count: ${matches.length}`);
        return matches.length;
      }
    } catch (e) {}
    return 1;
  }
}

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE);
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Data read error, using defaults');
  }
  return { jobs: [], stats: {} };
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function addJob(fileName, pages, copies, amount, status = 'Printed') {
  const data = readData();
  const job = {
    id: String(Date.now()).slice(-6).padStart(6, '0'),
    fileName,
    pages,
    copies,
    amount,
    status,
    time: new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
  };
  data.jobs.unshift(job);

  const stats = data.stats || {};
  stats.totalSavings = (stats.totalSavings || 0) + amount;
  stats.totalJobs = (stats.totalJobs || 0) + 1;
  stats.totalPages = (stats.totalPages || 0) + pages;
  stats.totalCopies = (stats.totalCopies || 0) + copies;

  const today = new Date().toDateString();
  if (stats.lastDate !== today) {
    stats.todayJobs = 0;
    stats.todayPages = 0;
    stats.todayEarnings = 0;
    stats.lastDate = today;
  }
  stats.todayJobs = (stats.todayJobs || 0) + 1;
  stats.todayPages = (stats.todayPages || 0) + pages;
  stats.todayEarnings = (stats.todayEarnings || 0) + amount;

  data.stats = stats;
  writeData(data);
  return job;
}

function getLast7DaysEarnings(jobs) {
  const today = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const result = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toDateString();
    const dayTotal = jobs
      .filter(j => new Date(j.time).toDateString() === dateStr)
      .reduce((sum, j) => sum + (j.amount || 0), 0);
    result.push(dayTotal);
  }
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    labels.push(dayNames[d.getDay()]);
  }
  return { labels, data: result };
}

// ---- API ROUTES ----
app.get('/api/config', (req, res) => res.json(getConfig()));

app.post('/api/config', adminAuth, (req, res) => {
  const { logo, background, outerBackground, icon, printerImage } = req.body;
  const cfg = getConfig();
  if (logo !== undefined) cfg.logo = logo;
  if (background !== undefined) cfg.background = background;
  if (outerBackground !== undefined) cfg.outerBackground = outerBackground;
  if (icon !== undefined) cfg.icon = icon;
  if (printerImage !== undefined) cfg.printerImage = printerImage;
  saveConfig(cfg);
  res.json({ success: true, config: cfg });
});

app.post('/api/admin/change-password', adminAuth, (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body;
  const creds = getAdminCredentials();
  if (currentPassword !== creds.password) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const cfg = getConfig();
  if (newUsername && newUsername.trim().length > 0) {
    cfg.adminUser = newUsername.trim();
  }
  if (newPassword && newPassword.trim().length >= 4) {
    cfg.adminPassword = newPassword.trim();
  } else if (newPassword !== undefined && newPassword.trim().length > 0 && newPassword.trim().length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters' });
  }
  saveConfig(cfg);
  res.json({ success: true, message: 'Credentials updated successfully', username: cfg.adminUser || 'admin' });
});

app.get('/api/dashboard', adminAuth, (req, res) => {
  const data = readData();
  const stats = data.stats || {};
  const totalUsers = stats.totalSessions || 0;
  const uptimeMs = Date.now() - SERVER_START_TIME;
  const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
  const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
  const uptimeStr = `${uptimeHours}h ${uptimeMinutes}m`;
  const { labels, data: earningsData } = getLast7DaysEarnings(data.jobs || []);
  res.json({
    stats: { ...stats, totalUsers, uptime: uptimeStr },
    recentJobs: (data.jobs || []).slice(0, 10),
    chart: { labels, data: earningsData }
  });
});

app.get('/api/jobs', adminAuth, (req, res) => {
  const data = readData();
  res.json(data.jobs || []);
});

app.get('/api/logs', adminAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 500;
  const recent = logs.slice(-limit);
  res.json({ logs: recent });
});

app.post('/api/logs/clear', adminAuth, (req, res) => {
  logs.length = 0;
  res.json({ success: true });
});

app.get('/api/ping', (req, res) => res.json({ status: 'ok' }));

app.post('/api/create-session', async (req, res) => {
  const token = uuidv4();
  const expires = Date.now() + CONFIG.SESSION_EXPIRY_SEC * 1000;
  sessions.set(token, {
    used: false,
    fileInfo: null,
    settings: { paperSize: 'A4', color: 'bw', copies: 1 },
    payment: { total: 0, inserted: 0, status: 'pending' },
    expires
  });
  const data = readData();
  data.stats.totalSessions = (data.stats.totalSessions || 0) + 1;
  writeData(data);

  // Use BASE_URL environment variable for QR code
  const baseUrl = process.env.BASE_URL || process.env.PUBLIC_URL;
  let uploadUrl;
  if (baseUrl) {
    const cleanBase = baseUrl.replace(/\/+$/, '');
    uploadUrl = `${cleanBase}/upload/${token}`;
  } else {
    const ip = getLocalIP();
    uploadUrl = `http://${ip}:${CONFIG.PORT}/upload/${token}`;
  }
  const qr = await QRCode.toDataURL(uploadUrl, { width: 420, margin: 2 });
  res.json({ token, qr, expiresIn: CONFIG.SESSION_EXPIRY_SEC });
});

app.get('/upload/:token', (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session || session.used || Date.now() > session.expires)
    return res.send(errorPage('Invalid or expired link'));
  res.sendFile(path.join(PUBLIC_DIR, 'upload.html'));
});

app.post('/api/upload/:token', upload.single('file'), async (req, res) => {
  console.log('[UPLOAD] File received:', req.file ? req.file.originalname : 'none');
  const session = sessions.get(req.params.token);
  if (!session || session.used || Date.now() > session.expires) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Invalid session' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
  if (!allowed.includes(ext)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'File type not allowed' });
  }
  let pages = 1;
  if (ext === '.pdf') {
    pages = await getPageCount(req.file.path);
  }
  const fileInfo = {
    name: req.file.originalname,
    size: req.file.size,
    pages,
    path: req.file.path
  };
  session.fileInfo = fileInfo;
  session.used = true;
  updateTotal(session);
  console.log(`[UPLOAD] Accepted: ${req.file.originalname}, pages: ${pages}`);
  res.json({ success: true, message: 'File uploaded' });
});

app.get('/api/session-status/:token', (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { fileInfo, settings, payment, used } = session;
  res.json({
    used,
    fileInfo: fileInfo ? { name: fileInfo.name, size: fileInfo.size, pages: fileInfo.pages } : null,
    settings,
    payment,
    isExpired: Date.now() > session.expires
  });
});

app.post('/api/update-settings/:token', (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session || !session.fileInfo) return res.status(404).json({ error: 'No file' });
  const { paperSize, color, copies } = req.body;
  if (paperSize) session.settings.paperSize = paperSize;
  if (color) session.settings.color = color;
  if (copies) session.settings.copies = parseInt(copies) || 1;
  updateTotal(session);
  res.json({ success: true, payment: session.payment });
});

app.post('/api/insert-coin/:token', (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session || !session.fileInfo) return res.status(404).json({ error: 'No session' });
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  session.payment.inserted += amount;
  updateTotal(session);
  res.json({ payment: session.payment });
});

function updateTotal(session) {
  const pages = session.fileInfo?.pages || 1;
  const copies = session.settings?.copies || 1;
  let total = pages * copies * CONFIG.PRICE_PER_PAGE;
  if (session.settings?.color === 'color') total += CONFIG.COLOR_EXTRA;
  if (session.settings?.paperSize === 'Legal') total += CONFIG.LEGAL_EXTRA;
  session.payment.total = total;
  session.payment.status = session.payment.inserted >= total ? 'paid' : 'pending';
}

app.post('/api/start-print/:token', (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session || !session.fileInfo) return res.status(404).json({ error: 'No file' });
  if (session.payment.status !== 'paid') {
    return res.status(402).json({ error: 'Payment not complete' });
  }
  const finalName = `${Date.now()}_${session.fileInfo.name}`;
  const finalPath = path.join(PRINT_QUEUE, finalName);
  fs.renameSync(session.fileInfo.path, finalPath);
  console.log(`[PRINT] Queued: ${finalPath}`);
  tryPrint(finalPath);
  session.queuedFile = finalName;
  addJob(
    session.fileInfo.name,
    session.fileInfo.pages,
    session.settings.copies,
    session.payment.total
  );
  setTimeout(() => sessions.delete(req.params.token), 60000);
  res.json({ success: true, message: 'Print started', filename: finalName });
});

app.post('/api/delete-print/:filename', (req, res) => {
  const filePath = path.join(PRINT_QUEUE, path.basename(req.params.filename));
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

function tryPrint(filePath) {
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') {
    cmd = `start "" "${filePath}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${filePath}"`;
  } else {
    cmd = `xdg-open "${filePath}"`;
  }
  exec(cmd, (err) => {
    if (err) console.error('Failed to open file:', err.message);
  });
}

app.get('/api/queue', adminAuth, (req, res) => {
  try {
    const files = fs.readdirSync(PRINT_QUEUE)
      .filter(f => !f.startsWith('.'))
      .map(f => {
        const full = path.join(PRINT_QUEUE, f);
        const stat = fs.statSync(full);
        return { name: f, size: stat.size, time: stat.mtimeMs };
      })
      .sort((a, b) => b.time - a.time);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: 'Cannot read queue' });
  }
});

app.delete('/api/queue/:filename', adminAuth, (req, res) => {
  const file = path.join(PRINT_QUEUE, path.basename(req.params.filename));
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    res.json({ success: true });
  } else res.status(404).json({ error: 'Not found' });
});

app.post('/api/print/:filename', adminAuth, (req, res) => {
  const file = path.join(PRINT_QUEUE, path.basename(req.params.filename));
  if (fs.existsSync(file)) {
    tryPrint(file);
    res.json({ success: true });
  } else res.status(404).json({ error: 'Not found' });
});

// Cleanup expired sessions every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions.entries()) {
    if (now > s.expires) sessions.delete(token);
  }
}, 60000);

function errorPage(msg) {
  return `<html><body><h2>${msg}</h2></body></html>`;
}

// Serve admin dashboard at root (or /admin)
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Listen on all interfaces
app.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${CONFIG.PORT}`);
});

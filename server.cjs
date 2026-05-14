const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const morgan = require('morgan');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const os = require('os');
const fs = require('fs');

dotenv.config();
const app = express();
const upload = multer({ dest: os.tmpdir() });

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Cấu hình Database
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true
};

const pool = mysql.createPool(dbConfig);

// Kiểm tra kết nối
pool.getConnection().then(() => console.log('Connected to MySQL Database')).catch(err => console.error('DB Connection Error:', err));

// --- LOGIC IMPORT EXCEL ---
app.post('/api/data/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
  try {
    const workbook = xlsx.readFile(req.file.path);
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    let count = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0]) {
        const code = String(row[0]).trim().toUpperCase();
        const name = row[1] ? String(row[1]).trim() : '';
        await pool.execute("INSERT INTO shipments (tracking_code, customer_name, status) VALUES (?, ?, 'PENDING') ON DUPLICATE KEY UPDATE customer_name = ?", [code, name, name]);
        count++;
      }
    }
    fs.unlinkSync(req.file.path);
    res.json({ success: true, message: `Đã nhập ${count} đơn`, count });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// --- LOGIC QUÉT MÃ ---
app.post('/api/scan', async (req, res) => {
  const { tracking_code, user_id } = req.body;
  try {
    const [rows] = await pool.execute('SELECT * FROM shipments WHERE tracking_code = ?', [tracking_code]);
    if (rows.length === 0) {
      await pool.execute("INSERT INTO scanned_logs (tracking_code, status) VALUES (?, 'INVALID')", [tracking_code]);
      return res.status(404).json({ success: false, status: 'INVALID', message: 'KHÔNG TỒN TẠI' });
    }
    const shipment = rows[0];
    if (shipment.status === 'RECEIVED') {
      await pool.execute("INSERT INTO scanned_logs (tracking_code, status) VALUES (?, 'DUPLICATE')", [tracking_code]);
      return res.status(400).json({ success: false, status: 'DUPLICATE', message: 'ĐÃ QUÉT TRƯỚC ĐÓ', customer_name: shipment.customer_name });
    }
    await pool.execute("UPDATE shipments SET status = 'RECEIVED', updated_at = NOW() WHERE tracking_code = ?", [tracking_code]);
    await pool.execute("INSERT INTO scanned_logs (tracking_code, status) VALUES (?, 'VALID')", [tracking_code]);
    res.json({ success: true, status: 'VALID', customer_name: shipment.customer_name });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// --- LOGIC THỐNG KÊ ---
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM shipments');
    const [[{ valid }]] = await pool.execute("SELECT COUNT(*) as valid FROM shipments WHERE status = 'RECEIVED'");
    const [[{ invalid }]] = await pool.execute("SELECT COUNT(*) as invalid FROM scanned_logs WHERE status = 'INVALID'");
    const [[{ duplicate }]] = await pool.execute("SELECT COUNT(*) as duplicate FROM scanned_logs WHERE status = 'DUPLICATE'");
    res.json({ success: true, total_shipments: total, valid_scans: valid, invalid_scans: invalid, duplicate_scans: duplicate });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// --- CÁC API KHÁC ---
app.get('/api/scan/logs', async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM scanned_logs ORDER BY created_at DESC LIMIT 50');
  res.json({ success: true, logs: rows });
});
app.post('/api/data/reset', async (req, res) => {
  await pool.execute('DELETE FROM scanned_logs'); await pool.execute('DELETE FROM shipments');
  res.json({ success: true, message: 'Đã xóa sạch' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

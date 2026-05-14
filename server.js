// VERSION 2.0 - FIX CỨNG DẤU NGOẶC ĐƠN VÀ EXCEL KHÔNG TIÊU ĐỀ
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const multer = require('multer');
const xlsx = require('xlsx');
const os = require('os');
const fs = require('fs');

dotenv.config();
const app = express();
const upload = multer({ dest: os.tmpdir() });

app.use(cors());
app.use(express.json());

// Cấu hình Database - Quan trọng là cái SSL để chạy được trên Aiven/Render
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: { rejectUnauthorized: false }, 
  waitForConnections: true,
  connectionLimit: 10
});

// KIỂM TRA KẾT NỐI
pool.getConnection().then(() => console.log('✅ Database Connected!')).catch(err => console.error('❌ DB Error:', err));

// --- API IMPORT EXCEL (ĐÃ FIX DẤU NGOẶC ĐƠN) ---
app.post('/api/data/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    
    let count = 0;
    // Chạy từ i = 0 vì file của bạn không có tiêu đề
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row && row[0]) {
        const code = String(row[0]).trim().toUpperCase();
        // DÙNG DẤU NGOẶC ĐƠN 'PENDING' ĐỂ KHÔNG BỊ LỖI UNKNOWN COLUMN
        await pool.execute(
          "INSERT INTO shipments (tracking_code, customer_name, status) VALUES (?, 'Khách hàng', 'PENDING') ON DUPLICATE KEY UPDATE status = 'PENDING'", 
          [code]
        );
        count++;
      }
    }
    fs.unlinkSync(req.file.path);
    res.json({ success: true, message: `Thành công! Đã nhập ${count} mã vận đơn.` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi Database: ' + error.message });
  }
});

// --- CÁC API KHÁC CHO MÁY QUÉT ---
app.post('/api/scan', async (req, res) => {
  const { tracking_code } = req.body;
  try {
    const [rows] = await pool.execute("SELECT * FROM shipments WHERE tracking_code = ?", [tracking_code]);
    if (rows.length === 0) return res.status(404).json({ success: false, status: 'INVALID' });
    if (rows[0].status === 'RECEIVED') return res.status(400).json({ success: false, status: 'DUPLICATE' });
    await pool.execute("UPDATE shipments SET status = 'RECEIVED' WHERE tracking_code = ?", [tracking_code]);
    res.json({ success: true, status: 'VALID' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dashboard/stats', async (req, res) => {
    const [[{total}]] = await pool.execute('SELECT COUNT(*) as total FROM shipments');
    const [[{valid}]] = await pool.execute("SELECT COUNT(*) as valid FROM shipments WHERE status = 'RECEIVED'");
    res.json({ success: true, total_shipments: total, valid_scans: valid });
});

app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('🚀 Server Ready!'));

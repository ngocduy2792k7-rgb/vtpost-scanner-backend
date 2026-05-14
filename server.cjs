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

pool.getConnection().then(() => console.log('✅ DB Connected')).catch(err => console.error(err));

// API IMPORT
app.post('/api/data/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    let count = 0;
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row && row[0]) {
        const code = String(row[0]).trim().toUpperCase();
        await pool.execute("INSERT INTO shipments (tracking_code, customer_name, status) VALUES (?, 'Khách hàng', 'PENDING') ON DUPLICATE KEY UPDATE status = 'PENDING'", [code]);
        count++;
      }
    }
    fs.unlinkSync(req.file.path);
    res.json({ success: true, message: `Thành công! Đã nhập ${count} mã.` });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// API QUÉT MÃ
app.post('/api/scan', async (req, res) => {
  const { tracking_code } = req.body;
  try {
    const [rows] = await pool.execute("SELECT * FROM shipments WHERE tracking_code = ?", [tracking_code]);
    if (rows.length === 0) return res.status(404).json({ success: false, status: 'INVALID' });
    if (rows[0].status === 'RECEIVED') return res.status(400).json({ success: false, status: 'DUPLICATE' });
    await pool.execute("UPDATE shipments SET status = 'RECEIVED', updated_at = NOW() WHERE tracking_code = ?", [tracking_code]);
    res.json({ success: true, status: 'VALID' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- FIX LỖI TRẮNG TRANG THỐNG KÊ ---
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const [[{total}]] = await pool.execute('SELECT COUNT(*) as total FROM shipments');
        const [[{valid}]] = await pool.execute("SELECT COUNT(*) as valid FROM shipments WHERE status = 'RECEIVED'");
        
        const result = {
            total_shipments: total,
            valid_scans: valid
        };

        // GỬI ĐA DẠNG KIỂU ĐỂ KIỂU GÌ CŨNG TRÚNG!
        res.json({ 
            success: true, 
            stats: result,      // Kiểu 1: Bọc trong stats
            data: result,       // Kiểu 2: Bọc trong data
            total_shipments: total, // Kiểu 3: Để trần
            valid_scans: valid      // Kiểu 3: Để trần
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// --- THÊM API LỊCH SỬ ĐỂ HẾT LỖI 404 ---
app.get('/api/scan/logs', async (req, res) => {
    try {
        const [rows] = await pool.execute("SELECT tracking_code, status, updated_at FROM shipments WHERE status = 'RECEIVED' ORDER BY updated_at DESC LIMIT 20");
        // Gửi cả logs và data.logs cho chắc
        res.json({ success: true, logs: rows, data: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('🚀 Server Ready!'));

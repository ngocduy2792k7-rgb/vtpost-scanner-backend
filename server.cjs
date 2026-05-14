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

// 1. API IMPORT EXCEL
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

// 2. API QUÉT MÃ
app.post('/api/scan', async (req, res) => {
  const { tracking_code } = req.body;
  try {
    const [rows] = await pool.execute("SELECT * FROM shipments WHERE tracking_code = ?", [tracking_code]);
    if (rows.length === 0) return res.status(404).json({ success: false, status: 'INVALID', message: 'Mã không tồn tại!' });
    if (rows[0].status === 'RECEIVED') return res.status(400).json({ success: false, status: 'DUPLICATE', message: 'Mã này đã được quét rồi!' });
    await pool.execute("UPDATE shipments SET status = 'RECEIVED', updated_at = NOW() WHERE tracking_code = ?", [tracking_code]);
    res.json({ success: true, status: 'VALID', message: 'Quét thành công!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. API THỐNG KÊ (DASHBOARD)
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const [[{total}]] = await pool.execute('SELECT COUNT(*) as total FROM shipments');
        const [[{valid}]] = await pool.execute("SELECT COUNT(*) as valid FROM shipments WHERE status = 'RECEIVED'");
        const rate = total > 0 ? Math.round((valid / total) * 100) : 0;
        const statsData = { total_shipments: total, valid_scans: valid, completion_rate: rate, invalid_scans: 0 };
        res.json({ success: true, stats: statsData, data: statsData, ...statsData });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. API LỊCH SỬ QUÉT
app.get('/api/scan/logs', async (req, res) => {
    try {
        const [rows] = await pool.execute("SELECT tracking_code, status, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') as updated_at FROM shipments WHERE status = 'RECEIVED' ORDER BY updated_at DESC LIMIT 20");
        res.json({ success: true, logs: rows, data: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5. API XUẤT BÁO CÁO EXCEL
app.get('/api/data/export', async (req, res) => {
    try {
        const [rows] = await pool.execute("SELECT tracking_code as 'Mã Vận Đơn', status as 'Trạng Thái', updated_at as 'Thời Gian Quét' FROM shipments");
        const worksheet = xlsx.utils.json_to_sheet(rows);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, "BaoCao");
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename=Bao-Cao-Doi-Soat.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (e) { res.status(500).send(e.message); }
});

// 6. API RESET HỆ THỐNG (DỌN DẸP DỮ LIỆU)
app.post('/api/data/reset', async (req, res) => {
    try {
        await pool.execute("DELETE FROM shipments");
        res.json({ success: true, message: "Hệ thống đã được reset sạch sẽ!" });
    } catch (e) { res.status(500).json({ success: false, message: "Lỗi reset: " + e.message }); }
});

app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('🚀 Server Ready!'));

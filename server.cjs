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
    if (rows.length === 0) return res.status(404).json({ success: false, status: 'INVALID', message: 'Mã không tồn tại!' });
    if (rows[0].status === 'RECEIVED') return res.status(400).json({ success: false, status: 'DUPLICATE', message: 'Mã này đã được quét trước đó!' });
    
    // Cập nhật trạng thái và thời gian quét
    await pool.execute("UPDATE shipments SET status = 'RECEIVED', updated_at = NOW() WHERE tracking_code = ?", [tracking_code]);
    res.json({ success: true, status: 'VALID', message: 'Quét thành công!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// API THỐNG KÊ (FIX LỖI THẺ DASHBOARD)
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const [[{total}]] = await pool.execute('SELECT COUNT(*) as total FROM shipments');
        const [[{valid}]] = await pool.execute("SELECT COUNT(*) as valid FROM shipments WHERE status = 'RECEIVED'");
        
        // Tính % hoàn thành
        const rate = total > 0 ? Math.round((valid / total) * 100) : 0;

        const statsData = {
            total_shipments: total,
            valid_scans: valid,
            completion_rate: rate,
            invalid_scans: 0 // Bạn có thể đếm số lỗi 404 từ log nếu cần
        };

        res.json({ success: true, stats: statsData, data: statsData, ...statsData });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API LỊCH SỬ (FIX LỖI INVALID DATE)
app.get('/api/scan/logs', async (req, res) => {
    try {
        // Dùng DATE_FORMAT để ép MySQL trả về chuỗi thời gian chuẩn ISO
        const [rows] = await pool.execute("SELECT tracking_code, status, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') as updated_at FROM shipments WHERE status = 'RECEIVED' ORDER BY updated_at DESC LIMIT 20");
        res.json({ success: true, logs: rows, data: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API XUẤT BÁO CÁO EXCEL (FIX LỖI 404)
app.get('/api/data/export', async (req, res) => {
    try {
        const [rows] = await pool.execute("SELECT tracking_code as 'Mã Vận Đơn', status as 'Trạng Thái', updated_at as 'Thời Gian Quét' FROM shipments");
        
        const worksheet = xlsx.utils.json_to_sheet(rows);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, "BaoCao");
        
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Disposition', 'attachment; filename=Bao-Cao-Quet-Ma.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (e) { res.status(500).send("Lỗi xuất file: " + e.message); }
});

app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('🚀 Server Ready!'));

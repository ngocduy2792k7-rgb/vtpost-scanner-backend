const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

// Cấu hình multer để upload file tạm thời
const upload = multer({ dest: 'uploads/' });

// Hàm chuẩn hóa mã vận đơn: Trim, Uppercase, loại bỏ ký tự rác ẩn
const normalizeCode = (code) => {
  if (!code) return '';
  return String(code)
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Loại bỏ ký tự zero-width rác
    .replace(/\s+/g, '') // Xóa mọi khoảng trắng
    .toUpperCase();
};

// POST /api/data/import - Import dữ liệu từ Excel/CSV
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  try {
    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // raw: false giúp xlsx tự động format giá trị dựa trên định dạng ô (giúp tránh số mũ E+11)
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: false });

    if (data.length === 0) {
      return res.status(400).json({ success: false, message: 'File Excel trống' });
    }

    let trackingColIndex = -1;
    let customerColIndex = -1;
    let startRow = 0;

    // Tìm dòng tiêu đề và xác định cột
    for (let i = 0; i < Math.min(15, data.length); i++) {
      const row = data[i];
      if (!Array.isArray(row)) continue;
      
      for (let j = 0; j < row.length; j++) {
        const cellValue = String(row[j] || '').toLowerCase();
        if (trackingColIndex === -1 && (cellValue.includes('mã') || cellValue.includes('vận đơn') || cellValue.includes('tracking') || cellValue.includes('code'))) {
          trackingColIndex = j;
        }
        if (customerColIndex === -1 && (cellValue.includes('khách') || cellValue.includes('tên') || cellValue.includes('name'))) {
          customerColIndex = j;
        }
      }
      if (trackingColIndex !== -1) {
        startRow = i + 1;
        break;
      }
    }

    // Nếu không tìm thấy tiêu đề, mặc định lấy cột 0 và 1
    if (trackingColIndex === -1) trackingColIndex = 0;
    if (customerColIndex === -1) customerColIndex = 1;

    let importedCount = 0;
    for (let i = startRow; i < data.length; i++) {
      const row = data[i];
      if (!Array.isArray(row) || !row[trackingColIndex]) continue;

      const rawCode = row[trackingColIndex];
      const trackingCode = normalizeCode(rawCode);
      const customerName = row[customerColIndex] ? String(row[customerColIndex]).trim() : '';

      if (trackingCode.length >= 5) { // Đảm bảo mã có độ dài tối thiểu
        await db.execute(
          'INSERT INTO shipments (tracking_code, customer_name, status) VALUES (?, ?, "PENDING") ON DUPLICATE KEY UPDATE customer_name = ?',
          [trackingCode, customerName, customerName]
        );
        importedCount++;
      }
    }

    // Xóa file tạm
    fs.unlinkSync(filePath);

    res.json({ success: true, message: `Đã import thành công ${importedCount} vận đơn`, count: importedCount });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi xử lý file import' });
  }
});

// GET /api/data/export - Xuất báo cáo Excel
router.get('/export', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT tracking_code as 'Mã vận đơn', customer_name as 'Tên khách hàng', 
             CASE WHEN status = 'RECEIVED' THEN 'Đã nhận' ELSE 'Chưa nhận' END as 'Trạng thái', 
             updated_at as 'Thời gian quét'
      FROM shipments
      WHERE status = 'RECEIVED'
    `);

    const worksheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'KetQuaDoiSoat');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename=bao_cao_doi_soat.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi xuất file báo cáo' });
  }
});

// POST /api/data/reset - Reset TOÀN DIỆN
router.post('/reset', async (req, res) => {
  try {
    // Xóa sạch dữ liệu trong bảng thay vì chỉ update status
    await db.execute('DELETE FROM scanned_logs');
    await db.execute('DELETE FROM shipments');
    
    // Reset AUTO_INCREMENT (tùy chọn)
    try {
      await db.execute('ALTER TABLE scanned_logs AUTO_INCREMENT = 1');
      await db.execute('ALTER TABLE shipments AUTO_INCREMENT = 1');
    } catch (e) {}

    res.json({ success: true, message: 'Hệ thống đã được xóa sạch dữ liệu. Trạng thái như mới.' });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi reset dữ liệu' });
  }
});

module.exports = router;


module.exports = router;

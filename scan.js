const express = require('express');
const router = express.Router();
const db = require('../db');

// Hàm chuẩn hóa mã vận đơn (phải khớp với logic import)
const normalizeCode = (code) => {
  if (!code) return '';
  return String(code)
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
};

// POST /api/scan
// Xử lý quét mã
router.post('/', async (req, res) => {
  try {
    let { tracking_code, user_id } = req.body;
    
    if (!tracking_code) {
      return res.status(400).json({ success: false, message: 'Tracking code is required' });
    }

    // Chuẩn hóa mã trước khi xử lý
    tracking_code = normalizeCode(tracking_code);

    // Lọc mã: tối thiểu 5 ký tự
    if (tracking_code.length < 5) {
      return res.json({ success: false, message: 'Mã quá ngắn hoặc không hợp lệ' });
    }

    // 1. Kiểm tra mã trong bảng shipments
    const [shipments] = await db.execute('SELECT * FROM shipments WHERE tracking_code = ?', [tracking_code]);
    
    if (shipments.length === 0) {
      // KHÔNG CÓ TRONG DS -> Đổi thành INVALID để đúng ENUM trong DB
      await db.execute('INSERT INTO scanned_logs (tracking_code, status, user_id) VALUES (?, ?, ?)', 
        [tracking_code, 'INVALID', user_id || null]);
        
      return res.json({
        success: true,
        status: 'INVALID',
        message: 'KHÔNG CÓ TRONG DS',
        tracking_code
      });
    }

    const shipment = shipments[0];

    // 2. Kiểm tra xem đã scan chưa (shipment.status = 'RECEIVED')
    if (shipment.status === 'RECEIVED') {
      // ĐÃ SCAN TRƯỚC ĐÓ
      await db.execute('INSERT INTO scanned_logs (tracking_code, status, user_id) VALUES (?, ?, ?)', 
        [tracking_code, 'DUPLICATE', user_id || null]);
        
      return res.json({
        success: true,
        status: 'DUPLICATE',
        message: 'ĐÃ QUÉT TRƯỚC ĐÓ',
        tracking_code,
        customer_name: shipment.customer_name
      });
    }

    // 3. Tồn tại và chưa scan -> THÀNH CÔNG -> Đổi thành VALID để đúng ENUM
    // Cập nhật trạng thái shipments
    await db.execute('UPDATE shipments SET status = "RECEIVED", updated_at = NOW() WHERE tracking_code = ?', [tracking_code]);
    
    // Ghi log
    await db.execute('INSERT INTO scanned_logs (tracking_code, status, user_id) VALUES (?, ?, ?)', 
      [tracking_code, 'VALID', user_id || null]);

    return res.json({
      success: true,
      status: 'VALID',
      message: 'ĐÃ NHẬN',
      tracking_code,
      customer_name: shipment.customer_name
    });

  } catch (error) {
    console.error('Stack Error in /api/scan:', error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ: ' + error.message });
  }
});

// GET /api/scan/logs
// Lấy lịch sử scan gần nhất (hiển thị real-time)
router.get('/logs', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT l.id, l.tracking_code, l.status, l.scanned_at, s.customer_name 
      FROM scanned_logs l
      LEFT JOIN shipments s ON l.tracking_code = s.tracking_code
      ORDER BY l.scanned_at DESC LIMIT 50
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Stack Error in /api/scan/logs:', error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ: ' + error.message });
  }
});

module.exports = router;

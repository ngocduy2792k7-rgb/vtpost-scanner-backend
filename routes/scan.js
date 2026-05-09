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

  try {
    // 1. Kiểm tra mã trong bảng shipments
    const [shipments] = await db.execute('SELECT * FROM shipments WHERE tracking_code = ?', [tracking_code]);
    
    if (shipments.length === 0) {
      // KHÔNG CÓ TRONG DS
      await db.execute('INSERT INTO scanned_logs (tracking_code, status, user_id) VALUES (?, ?, ?)', 
        [tracking_code, 'NOT_FOUND', user_id || null]);
        
      return res.json({
        success: true,
        status: 'NOT_FOUND',
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

    // 3. Tồn tại và chưa scan -> THÀNH CÔNG
    // Cập nhật trạng thái shipments
    await db.execute('UPDATE shipments SET status = "RECEIVED", updated_at = NOW() WHERE tracking_code = ?', [tracking_code]);
    
    // Ghi log
    await db.execute('INSERT INTO scanned_logs (tracking_code, status, user_id) VALUES (?, ?, ?)', 
      [tracking_code, 'SUCCESS', user_id || null]);

    return res.json({
      success: true,
      status: 'SUCCESS',
      message: 'ĐÃ NHẬN',
      tracking_code,
      customer_name: shipment.customer_name
    });

  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
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
    console.error('Get logs error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});


module.exports = router;

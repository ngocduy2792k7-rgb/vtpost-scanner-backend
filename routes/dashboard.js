const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    // Tổng số đơn gốc
    const [[{ total_shipments }]] = await db.execute('SELECT COUNT(*) as total_shipments FROM shipments');
    
    // Tổng số đơn đã nhận (hợp lệ)
    const [[{ valid_scans }]] = await db.execute('SELECT COUNT(*) as valid_scans FROM shipments WHERE status = "RECEIVED"');
    
    // Tổng số lần quét không tồn tại (chỉ đếm số logs INVALID)
    const [[{ invalid_scans }]] = await db.execute('SELECT COUNT(*) as invalid_scans FROM scanned_logs WHERE status = "INVALID"');
    
    // Số lần quét trùng lặp
    const [[{ duplicate_scans }]] = await db.execute('SELECT COUNT(*) as duplicate_scans FROM scanned_logs WHERE status = "DUPLICATE"');

    // Tỷ lệ hoàn thành (trên tổng đơn)
    let completion_rate = 0;
    if (total_shipments > 0) {
      completion_rate = ((valid_scans / total_shipments) * 100).toFixed(2);
    }

    res.json({
      success: true,
      data: {
        total_shipments,
        valid_scans,
        invalid_scans,
        duplicate_scans,
        completion_rate
      }
    });

  } catch (error) {
    console.error('Stack Error in /api/dashboard/stats:', error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ: ' + error.message });
  }
});

module.exports = router;

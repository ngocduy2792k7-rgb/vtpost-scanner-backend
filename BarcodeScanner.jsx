import React, { useEffect, useState, useRef, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';
import { createWorker } from 'tesseract.js';
import axios from 'axios';
import {
  CheckCircle, XCircle, AlertCircle, History,
  CameraOff, RefreshCw, Keyboard, X, ScanLine, Hash, Camera
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

// Lọc và chuẩn hóa văn bản từ OCR
const cleanOcrText = (raw) => {
  return (raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ''); // Chỉ giữ lại chữ cái và số
};

const BarcodeScanner = () => {
  const [lastResult, setLastResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [cameraError, setCameraError] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [ocrStatus, setOcrStatus] = useState('idle');
  const [isSnapshotting, setIsSnapshotting] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const codeReaderRef = useRef(null);
  const ocrWorkerRef = useRef(null);
  const isPaused = useRef(false);
  const lastOcrCode = useRef('');

  const audioSuccess = useRef(null);
  const audioError = useRef(null);

  useEffect(() => {
    audioSuccess.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');
    audioError.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2573/2573-preview.mp3');
  }, []);

  // ─── Fetch lịch sử ───────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/scan/logs`);
      // Hỗ trợ cả key logs hoặc data từ backend mới
      setHistory(response.data.logs || response.data.data || []);
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  }, []);

  // ─── Xử lý kết quả quét ──────────────────────────────────────────
  const handleScan = useCallback(async (decodedText) => {
    if (isPaused.current || showManual) return;
    
    const code = String(decodedText).trim().toUpperCase();
    if (code.length < 5) return;

    isPaused.current = true;
    try {
      const response = await axios.post(`${API_URL}/scan`, { tracking_code: code });
      const result = response.data;
      
      if (result.success) {
        setLastResult({ ...result, message: result.message || 'QUÉT THÀNH CÔNG!' });
        audioSuccess.current?.play().catch(() => {});
      } else {
        setLastResult({ status: 'INVALID', message: result.message || 'LỖI', tracking_code: code });
        audioError.current?.play().catch(() => {});
      }

      fetchHistory();

      // Tự động ẩn thông báo sau 2.5 giây
      setTimeout(() => {
        setLastResult(null);
        isPaused.current = false;
        lastOcrCode.current = '';
        setIsSnapshotting(false);
      }, 2500);

    } catch (err) {
      console.error('API Error:', err);
      // Lấy thông báo lỗi chi tiết từ Server (Ví dụ: Mã không tồn tại, mã đã quét)
      const errorMsg = err.response?.data?.message || 'LỖI KẾT NỐI SERVER';
      const errorStatus = err.response?.data?.status || 'INVALID';
      
      setLastResult({ 
        status: errorStatus, 
        message: errorMsg.toUpperCase(), 
        tracking_code: code 
      });
      
      audioError.current?.play().catch(() => {});

      setTimeout(() => {
        setLastResult(null);
        isPaused.current = false;
        setIsSnapshotting(false);
      }, 2500);
    }
  }, [showManual, fetchHistory]);

  // ─── Khởi động Tesseract Worker ──────────────────────────────────
  const initOcrWorker = async () => {
    setOcrStatus('loading');
    try {
      const worker = await createWorker('eng', 1, { logger: () => {} });
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: '6',
      });
      ocrWorkerRef.current = worker;
      setOcrStatus('ready');
    } catch (e) {
      console.error('OCR Worker init failed:', e);
      setOcrStatus('error');
    }
  };

  // ─── SNAPSHOT OCR (nhấn nút để quét số) ─────────────────────────
  const captureSnapshotOcr = useCallback(async () => {
    if (isPaused.current || showManual) return;
    if (!ocrWorkerRef.current || ocrStatus !== 'ready') return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const canvas = canvasRef.current;
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    if (!vW || !vH) return;

    setIsSnapshotting(true);
    isPaused.current = true;

    const cropW = Math.floor(vW * 0.9);
    const cropH = Math.floor(vH * 0.45);
    const cropX = Math.floor((vW - cropW) / 2);
    const cropY = Math.floor((vH - cropH) / 2);

    const scale = 3;
    canvas.width = cropW * scale;
    canvas.height = cropH * scale;
    const ctx = canvas.getContext('2d');
    ctx.filter = 'contrast(2.0) brightness(1.2) grayscale(1)';
    ctx.scale(scale, scale);
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    try {
      const { data: { text } } = await ocrWorkerRef.current.recognize(canvas);
      const cleaned = cleanOcrText(text.toUpperCase());

      if (cleaned && cleaned.length >= 5 && cleaned !== lastOcrCode.current) {
        lastOcrCode.current = cleaned;
        await handleScan(cleaned);
      } else {
        setLastResult({
          status: 'INVALID',
          message: `KHÔNG ĐỌC ĐƯỢC MÃ`,
          tracking_code: cleaned || '(trống)'
        });
        setTimeout(() => {
          setLastResult(null);
          isPaused.current = false;
          setIsSnapshotting(false);
        }, 2000);
      }
    } catch (e) {
      console.error('OCR Error:', e);
      isPaused.current = false;
      setIsSnapshotting(false);
    }
  }, [ocrStatus, showManual, handleScan]);

  // ─── Khởi động camera + barcode scanner ──────────────────────────
  const startScanner = useCallback(async () => {
    setCameraError('');
    if (codeReaderRef.current) {
      try { codeReaderRef.current.reset(); } catch (e) {}
    }

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
      BarcodeFormat.ITF, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const codeReader = new BrowserMultiFormatReader(hints);
    codeReaderRef.current = codeReader;

    const tryDecode = async (constraints) => {
      await codeReader.decodeFromConstraints(constraints, videoRef.current, (result) => {
        if (result) handleScan(result.getText());
      });
    };

    try {
      await tryDecode({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch {
      try {
        await tryDecode({ video: true });
      } catch {
        setCameraError('Không thể truy cập Camera. Vui lòng dùng HTTPS và cấp quyền Camera.');
      }
    }
  }, [handleScan]);

  useEffect(() => {
    fetchHistory();
    startScanner();
    initOcrWorker();

    return () => {
      if (codeReaderRef.current) {
        try { codeReaderRef.current.reset(); } catch (e) {}
      }
      if (ocrWorkerRef.current) {
        ocrWorkerRef.current.terminate();
      }
    };
  }, [fetchHistory, startScanner]);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (manualCode.trim()) {
      handleScan(manualCode.trim().toUpperCase());
      setManualCode('');
      setShowManual(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'VALID': return 'var(--success-color)';
      case 'INVALID': return 'var(--error-color)';
      case 'DUPLICATE': return 'var(--warning-color)';
      default: return 'var(--text-muted)';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'VALID': return 'Đã nhận';
      case 'INVALID': return 'Không tồn tại';
      case 'DUPLICATE': return 'Đã quét rồi';
      default: return status;
    }
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '--:--';
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  const ocrColors = { idle: '#888', loading: '#facc15', ready: '#22c55e', error: '#ef4444' };
  const ocrLabels = { idle: 'OCR chưa sẵn sàng', loading: 'Đang tải OCR...', ready: 'OCR sẵn sàng', error: 'OCR lỗi' };

  return (
    <div className="grid">
      <div className="card scanner-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0 }}><ScanLine size={20} /> Máy quét vận đơn</h3>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            fontSize: '0.75rem', color: ocrColors[ocrStatus] || '#888',
            background: 'rgba(255,255,255,0.06)', borderRadius: '20px',
            padding: '3px 10px', border: `1px solid ${ocrColors[ocrStatus] || '#888'}44`
          }}>
            <Hash size={11} />{ocrLabels[ocrStatus] || '...'}
          </span>
        </div>

        {cameraError ? (
          <div className="camera-error">
            <CameraOff size={48} color="var(--error-color)" />
            <p>{cameraError}</p>
            <button className="btn btn-primary" onClick={startScanner} style={{ marginTop: '15px' }}>
              <RefreshCw size={16} /> Thử lại
            </button>
          </div>
        ) : (
          <div className="video-container">
            <video ref={videoRef} style={{ width: '100%', borderRadius: '12px', display: 'block' }} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div className="scan-overlay">
              <div className="scan-region"></div>
            </div>

            {ocrStatus === 'ready' && !isSnapshotting && (
              <button onClick={captureSnapshotOcr} className="btn-ocr-trigger">
                <Camera size={20} /> QUÉT SỐ
              </button>
            )}

            {isSnapshotting && (
              <div className="ocr-loading-overlay">
                <RefreshCw size={40} className="spin" />
                <p style={{ marginTop: '12px', fontWeight: 600 }}>Đang phân tích...</p>
              </div>
            )}
          </div>
        )}

        {lastResult && (
          <div className={`scan-result-overlay ${lastResult.status.toLowerCase()} pulse`}>
            {lastResult.status === 'VALID' && <CheckCircle size={64} />}
            {lastResult.status === 'INVALID' && <XCircle size={64} />}
            {lastResult.status === 'DUPLICATE' && <AlertCircle size={64} />}
            <h2>{lastResult.message}</h2>
            <p style={{ fontSize: '1.4rem', fontWeight: 700 }}>{lastResult.tracking_code}</p>
          </div>
        )}

        <button
          className="btn"
          onClick={() => setShowManual(!showManual)}
          style={{
            marginTop: '14px', width: '100%',
            background: 'rgba(255,255,255,0.07)',
            border: '1px dashed rgba(255,255,255,0.2)',
            color: 'var(--text-muted)', fontSize: '0.85rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
          }}
        >
          <Keyboard size={15} />
          {showManual ? 'Ẩn nhập thủ công' : 'Nhập mã thủ công'}
          {showManual && <X size={13} />}
        </button>

        {showManual && (
          <form onSubmit={handleManualSubmit} style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              placeholder="Nhập mã vận đơn..."
              autoFocus
              className="manual-input"
            />
            <button type="submit" className="btn btn-primary">Gửi</button>
          </form>
        )}
      </div>

      <div className="card">
        <h3><History size={20} /> Lịch sử quét</h3>
        <div className="history-list">
          {history.length === 0 && (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>Chưa có dữ liệu</p>
          )}
          {history.map((log, index) => (
            <div key={index} className="history-item">
              <div className="history-code">{log.tracking_code}</div>
              <div 
                className="history-status" 
                style={{ 
                  backgroundColor: `${getStatusColor(log.status)}22`, 
                  color: getStatusColor(log.status),
                  border: `1px solid ${getStatusColor(log.status)}44`
                }}
              >
                {getStatusLabel(log.status)}
              </div>
              <div className="history-time">
                {formatTime(log.updated_at)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BarcodeScanner;

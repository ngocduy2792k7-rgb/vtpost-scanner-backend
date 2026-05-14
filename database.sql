CREATE DATABASE IF NOT EXISTS vtpost_scanner;
USE vtpost_scanner;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('ADMIN', 'STAFF') DEFAULT 'STAFF',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bảng lưu trữ dữ liệu gốc vận đơn được import vào
CREATE TABLE IF NOT EXISTS shipments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tracking_code VARCHAR(100) UNIQUE NOT NULL,
  customer_name VARCHAR(255),
  status ENUM('PENDING', 'RECEIVED') DEFAULT 'PENDING',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Bảng lưu trữ lịch sử các lần quét mã
CREATE TABLE IF NOT EXISTS scanned_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tracking_code VARCHAR(100) NOT NULL,
  status ENUM('VALID', 'INVALID', 'DUPLICATE') NOT NULL,
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_id INT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Tạo tài khoản admin mặc định (password: admin123)
-- Lưu ý: Mật khẩu này được hash bằng bcrypt trong thực tế, nhưng để đơn giản test, ta để pass thường hoặc hash ở backend.
-- Ở đây ta sẽ xử lý hash ở backend nên script sql chỉ tạo bảng.

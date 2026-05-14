const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const morgan = require('morgan');
const path = require('path');

// Ưu tiên load .env.production nếu đang chạy ở môi trường production
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.resolve(__dirname, envFile) });

const app = express();

// CORS an toàn cho Vercel/Render
app.use(cors({
  origin: '*', // Để '*' để Vercel có thể call, bạn có thể thay bằng domain Vercel cụ thể để bảo mật hơn
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Log mọi request ra console
app.use(morgan('dev'));

// Routes
const scanRoutes = require('./routes/scan');
const dashboardRoutes = require('./routes/dashboard');
const dataRoutes = require('./routes/data');

app.use('/api/scan', scanRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/data', dataRoutes);

// Bắt lỗi toàn cục (Unhandled Errors)
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.stack);
  res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
});

const PORT = process.env.PORT || 5000;
// Lắng nghe trên 0.0.0.0 để Render có thể expose port ra ngoài
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

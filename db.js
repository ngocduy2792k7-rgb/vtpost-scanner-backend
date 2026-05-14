const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  ssl: {
      rejectUnauthorized: false
  }
});

const promisePool = pool.promise();

// Kiểm tra kết nối ban đầu
promisePool.getConnection()
  .then(connection => {
    console.log('Connected to MySQL Database');
    connection.release();
  })
  .catch(err => {
    console.error('Error connecting to MySQL:', err);
  });

// Ping database mỗi 30 giây để giữ connection luôn sống (Tránh lỗi trên Render/Vercel)
setInterval(async () => {
  try {
    await promisePool.query('SELECT 1');
  } catch (error) {
    console.error('Database ping failed. Checking connection...', error.message);
  }
}, 30000);

module.exports = promisePool;

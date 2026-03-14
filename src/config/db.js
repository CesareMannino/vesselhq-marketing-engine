const mysql = require('mysql2/promise');

function buildSslConfig() {
  if (String(process.env.DB_SSL || '').toLowerCase() !== 'true') {
    return undefined;
  }

  const ssl = {
    minVersion: 'TLSv1.2'
  };

  const caBase64 = String(process.env.DB_SSL_CA_BASE64 || '').trim();

  if (caBase64) {
    ssl.ca = Buffer.from(caBase64, 'base64').toString('utf8');
  }

  if (String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'false') {
    ssl.rejectUnauthorized = false;
  }

  return ssl;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'vesselhq_marketing',
  ssl: buildSslConfig(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function testConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}

module.exports = {
  pool,
  testConnection
};

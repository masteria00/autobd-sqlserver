const sql = require("mssql");

const pool = new sql.ConnectionPool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: Number(process.env.DB_PORT),
  options: { encrypt: true, trustServerCertificate: true },
});

module.exports = {
  async using(callback) {
    if (!pool.connected) await pool.connect();
    return callback(pool);
  },
  async close() {
    await pool.close();
  },
};

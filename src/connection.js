const sql = require("mssql");

function createDatabase(connectionOptions = {}) {
  const required = [
    "DB_USER",
    "DB_PASSWORD",
    "DB_SERVER",
    "DB_DATABASE",
    "DB_PORT",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length)
    throw new Error(
      `Missing SQL Server environment variables: ${missing.join(", ")}`,
    );

  const port = Number.parseInt(process.env.DB_PORT, 10);
  if (!Number.isInteger(port) || port <= 0)
    throw new Error("DB_PORT must be a positive integer");

  const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    port,
    options: {
      encrypt: connectionOptions.encrypt ?? process.env.DB_ENCRYPT !== "false",
      trustServerCertificate:
        connectionOptions.trustServerCertificate ??
        process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
    },
  };

  return {
    async withNewConnection(callback) {
      const pool = await new sql.ConnectionPool(config).connect();
      try {
        return await callback(pool);
      } finally {
        await pool.close();
      }
    },
    async close() {},
  };
}

module.exports = { createDatabase };

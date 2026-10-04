import sql = require("mssql");

declare const database: {
  using<T>(callback: (pool: sql.ConnectionPool) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export = database;

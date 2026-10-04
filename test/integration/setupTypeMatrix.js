const sql = require("mssql");
const typeCases = require("./typeCases");

if (process.env.DB_DATABASE !== "tests") {
  throw new Error("Type matrix setup requires the isolated tests database");
}

const pool = new sql.ConnectionPool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: Number(process.env.DB_PORT),
  options: { encrypt: true, trustServerCertificate: true },
});

async function setOptionalContract(procedureName, optionalName = "Optional") {
  const qualified = `autobd_types.${procedureName}`;
  const existing = await pool
    .request()
    .input("qualified", sql.NVarChar, qualified)
    .query(`
      SELECT COUNT(*) AS count
      FROM sys.extended_properties
      WHERE major_id = OBJECT_ID(@qualified)
        AND name = N'AutoBD.ResultContract'
    `);
  const command = existing.recordset[0].count
    ? "sys.sp_updateextendedproperty"
    : "sys.sp_addextendedproperty";
  await pool
    .request()
    .input("name", sql.NVarChar, "AutoBD.ResultContract")
    .input("value", sql.NVarChar, JSON.stringify({ optionalParameters: [optionalName] }))
    .input("level0type", sql.NVarChar, "SCHEMA")
    .input("level0name", sql.NVarChar, "autobd_types")
    .input("level1type", sql.NVarChar, "PROCEDURE")
    .input("level1name", sql.NVarChar, procedureName)
    .execute(command);
}

async function main() {
  await pool.connect();
  try {
    await pool.request().batch(`
      IF SCHEMA_ID(N'autobd_types') IS NULL
        EXEC(N'CREATE SCHEMA autobd_types');
    `);

    for (const item of typeCases) {
      const procedureName = `Test${item.name}`;
      const exactText = ["BigInt", "Decimal18", "Decimal38"].includes(item.name)
        ? "CONVERT(VARCHAR(100), @Value) AS ExactText,"
        : item.name === "DateTime2"
          ? "CONVERT(VARCHAR(40), @Value, 126) AS ExactText,"
          : "";
      await pool.request().batch(`
        CREATE OR ALTER PROCEDURE autobd_types.${procedureName}
          @Value ${item.sqlType},
          @Optional ${item.sqlType} = NULL,
          @Output ${item.sqlType} = NULL OUTPUT
        AS
        BEGIN
          SET NOCOUNT ON;
          SET @Output = @Value;
          SELECT
            @Value AS Value,
            @Optional AS OptionalValue,
            ${exactText}
            CAST(NULL AS ${item.sqlType}) AS NullValue;
        END;
      `);
      await setOptionalContract(procedureName);
    }

    await pool.request().batch(`
      IF OBJECT_ID(N'autobd_types.TestTVP', N'P') IS NOT NULL
        DROP PROCEDURE autobd_types.TestTVP;
      IF TYPE_ID(N'autobd_types.DetalleType') IS NOT NULL
        DROP TYPE autobd_types.DetalleType;
    `);
    await pool.request().batch(`
      CREATE TYPE autobd_types.DetalleType AS TABLE (
        Id INT NOT NULL,
        Nombre NVARCHAR(100) NULL,
        Cantidad DECIMAL(18,2) NOT NULL,
        Activo BIT NOT NULL
      );
    `);
    await pool.request().batch(`
      CREATE PROCEDURE autobd_types.TestTVP
        @Detalles autobd_types.DetalleType READONLY
      AS
      BEGIN
        SET NOCOUNT ON;
        SELECT Id, Nombre, Cantidad, Activo
        FROM @Detalles
        ORDER BY Id;
      END;
    `);

    await pool.request().batch(`
      CREATE OR ALTER PROCEDURE autobd_types.TestDateTime2Literal
      AS
      BEGIN
        SET NOCOUNT ON;
        SELECT CAST('2026-10-02T12:34:56.1234567' AS DATETIME2(7)) AS Value;
      END;
    `);
    await pool.request().batch(`
      CREATE OR ALTER PROCEDURE autobd_types.TestDefaultInt
        @Value INT = 7
      AS
      BEGIN
        SET NOCOUNT ON;
        SELECT @Value AS Value;
      END;
    `);
    await setOptionalContract("TestDefaultInt", "Value");

    console.log(`Created ${typeCases.length} type procedures, two special procedures and one TVP procedure`);
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

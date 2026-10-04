const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sql = require("mssql");
const generator = require("../../src/generator");
const consumer = path.join(__dirname, "consumer");
const wrapperJs = path.join(
  consumer,
  "generated/autobd_types/procedures/TestContractMutation.auto.js",
);
const wrapperTs = path.join(
  consumer,
  "generated/autobd_types/procedures/TestContractMutation.auto.ts",
);

if (process.env.DB_DATABASE !== "tests") {
  throw new Error("Contract mutation test requires isolated tests database");
}

const pool = new sql.ConnectionPool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: Number(process.env.DB_PORT),
  options: { encrypt: true, trustServerCertificate: true },
});

async function contract(optional) {
  const current = await pool.request().query(`
    SELECT COUNT(*) AS Count
    FROM sys.extended_properties
    WHERE major_id = OBJECT_ID(N'autobd_types.TestContractMutation')
      AND name = N'AutoBD.ResultContract'
  `);
  await pool
    .request()
    .input("name", sql.NVarChar, "AutoBD.ResultContract")
    .input(
      "value",
      sql.NVarChar,
      JSON.stringify({ optionalParameters: optional ? ["Value"] : [] }),
    )
    .input("level0type", sql.NVarChar, "SCHEMA")
    .input("level0name", sql.NVarChar, "autobd_types")
    .input("level1type", sql.NVarChar, "PROCEDURE")
    .input("level1name", sql.NVarChar, "TestContractMutation")
    .execute(
      current.recordset[0].Count
        ? "sys.sp_updateextendedproperty"
        : "sys.sp_addextendedproperty",
    );
}

async function generate() {
  const oldCwd = process.cwd();
  const oldArgs = process.argv;
  try {
    process.chdir(consumer);
    process.argv = [
      oldArgs[0],
      oldArgs[1],
      "generate",
      "--config",
      "config.autobd.json",
      "--procedure",
      "autobd_types.TestContractMutation",
    ];
    await generator.main();
  } finally {
    process.argv = oldArgs;
    process.chdir(oldCwd);
  }
}

async function stage(
  label,
  type,
  expectedBinding,
  expectedTsType,
  value,
  extraColumn = false,
  optional = false,
) {
  await pool.request().batch(`
    CREATE OR ALTER PROCEDURE autobd_types.TestContractMutation
      @Value ${type}${optional ? " = NULL" : ""}
    AS
    BEGIN
      SET NOCOUNT ON;
      SELECT @Value AS Value${extraColumn ? ", CAST(1 AS bit) AS Activo" : ""};
    END;
  `);
  await contract(optional);
  await generate();
  const js = fs.readFileSync(wrapperJs, "utf8");
  const ts = fs.readFileSync(wrapperTs, "utf8");
  assert.ok(js.includes(expectedBinding), `${label}: JS binding`);
  assert.ok(ts.includes(expectedBinding), `${label}: TS binding`);
  assert.ok(
    ts.includes(`Value${optional ? "?" : ""}: ${expectedTsType} | null;`),
    `${label}: TS parameter`,
  );
  assert.equal(
    ts.includes("Activo!: boolean"),
    extraColumn,
    `${label}: result columns`,
  );
  delete require.cache[require.resolve(wrapperJs)];
  const result = await require(wrapperJs).autobd_types_TestContractMutation(
    optional ? {} : { Value: value },
  );
  assert.equal(result.recordset.length, 1);
  if (extraColumn) assert.equal(result.recordset[0].Activo, true);
  console.log(
    `PASS ${label}: regenerated JS/TS binding, parameter, SELECT and JS execution`,
  );
}

async function main() {
  await pool.connect();
  try {
    await stage("INT required", "INT", "sql.Int", "number", 10);
    await stage(
      "INT to BIGINT",
      "BIGINT",
      "sql.BigInt",
      "string",
      "9007199254740993",
    );
    await stage(
      "VARCHAR to NVARCHAR: before",
      "VARCHAR(100)",
      "sql.VarChar(100)",
      "string",
      "plain",
    );
    await stage(
      "VARCHAR to NVARCHAR: after",
      "NVARCHAR(100)",
      "sql.NVarChar(100)",
      "string",
      "ñ 😀",
    );
    await stage(
      "DECIMAL18 before",
      "DECIMAL(18,2)",
      "sql.Decimal(18, 2)",
      "number",
      12.34,
    );
    await stage(
      "DECIMAL38 after",
      "DECIMAL(38,18)",
      "sql.Decimal(38, 18)",
      "number",
      1,
    );
    await stage(
      "DATETIME before",
      "DATETIME",
      "sql.DateTime",
      "Date",
      new Date("2026-10-02T12:00:00Z"),
    );
    await stage(
      "DATETIME2 after",
      "DATETIME2(7)",
      "sql.DateTime2(7)",
      "Date",
      new Date("2026-10-02T12:00:00Z"),
    );
    await stage(
      "required to optional",
      "INT",
      "sql.Int",
      "number",
      10,
      false,
      true,
    );
    await stage("optional to required", "INT", "sql.Int", "number", 10);
    await stage("SELECT adds column", "INT", "sql.Int", "number", 10, true);
  } finally {
    await pool.close();
    await require("./consumer/database").close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

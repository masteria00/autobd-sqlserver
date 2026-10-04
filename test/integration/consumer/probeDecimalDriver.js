const sql = require("mssql");
const database = require("./database");

async function main() {
  for (const [name, value] of [
    ["Decimal18", "1234567890123456.78"],
    ["Decimal38", "12345678901234567890.123456789012345678"],
  ]) {
    for (const outputType of [sql.Decimal(name === "Decimal18" ? 18 : 38, name === "Decimal18" ? 2 : 18), sql.NVarChar(100)]) {
      try {
        const result = await database.using(async (pool) => pool.request()
          .input("Value", sql.NVarChar(100), value)
          .output("Output", outputType)
          .execute(`[autobd_types].[Test${name}]`));
        console.log(JSON.stringify({ name, outputType: outputType.name, exactSql: result.recordset[0].ExactText, value: result.recordset[0].Value, output: result.output.Output }));
      } catch (error) {
        console.log(JSON.stringify({ name, outputType: outputType.name, error: error.message }));
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => database.close());

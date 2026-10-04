const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const compiled = path.join(__dirname, "ts-dist");
fs.copyFileSync(
  path.join(__dirname, "database.js"),
  path.join(compiled, "database.js"),
);
const generated = require("./ts-dist/generated");
const database = require("./ts-dist/database");

async function main() {
  const integer = await generated.autobd_types_TestInt({ Value: 42 });
  assert.equal(integer.recordset[0].Value, 42);
  assert.equal(integer.output.Output, 42);
  const bigint = await generated.autobd_types_TestBigInt({
    Value: "9007199254740993",
  });
  assert.equal(bigint.recordset[0].Value, "9007199254740993");
  const tvp = new generated.tvp.autobd_types_DetalleType([
    { Id: 1, Nombre: "ñ 😀", Cantidad: 12.34, Activo: true },
  ]);
  const rows = await generated.autobd_types_TestTVP({ Detalles: tvp });
  assert.equal(rows.recordset[0].Nombre, "ñ 😀");
  console.log(
    "PASS compiled TypeScript wrappers: INT, BIGINT > MAX_SAFE_INTEGER, TVP",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => database.close());

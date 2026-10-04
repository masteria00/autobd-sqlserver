const database = require("./database");
const generated = require("./generated");
const assert = require("node:assert/strict");

const run = generated.autobd_types_TestTVP;
const Table = generated.tvp.autobd_types_DetalleType;

async function test(name, rows, expectedCount, shouldFail = false) {
  let result;
  try {
    result = await run({ Detalles: new Table(rows) });
  } catch (error) {
    if (!shouldFail) throw error;
    console.log(
      JSON.stringify({ name, status: "ERROR", message: error.message }),
    );
    return;
  }
  assert.equal(shouldFail, false, `${name} should fail`);
  assert.equal(result.recordset.length, expectedCount, `${name} row count`);
  if (name === "many") {
    assert.equal(result.recordset[0].Nombre, null);
    assert.equal(result.recordset[1].Cantidad, 99.99);
  }
  if (name === "large") {
    assert.equal(result.recordset[0].Id, 1);
    assert.equal(result.recordset.at(-1).Id, 1000);
  }
  console.log(
    JSON.stringify({
      name,
      status: "OK",
      count: result.recordset.length,
      first: result.recordset[0] || null,
      last: result.recordset.at(-1) || null,
    }),
  );
}

async function main() {
  await test(
    "one",
    [{ Id: 1, Nombre: "ñ 😀", Cantidad: 12.34, Activo: true }],
    1,
  );
  await test(
    "many",
    [
      { Id: 1, Nombre: null, Cantidad: 0, Activo: false },
      { Id: 2, Nombre: "dos", Cantidad: 99.99, Activo: true },
    ],
    2,
  );
  await test("empty", [], 0);
  await test(
    "invalid-id",
    [{ Id: "no", Nombre: null, Cantidad: 1, Activo: true }],
    0,
    true,
  );
  await test(
    "invalid-required-null",
    [{ Id: 1, Nombre: null, Cantidad: null, Activo: true }],
    0,
    true,
  );
  await test(
    "large",
    Array.from({ length: 1000 }, (_, index) => ({
      Id: index + 1,
      Nombre: index % 2 ? null : `fila ${index}`,
      Cantidad: index / 100,
      Activo: index % 2 === 0,
    })),
    1000,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => database.close());

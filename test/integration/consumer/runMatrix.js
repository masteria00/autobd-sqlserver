const assert = require("node:assert/strict");
const database = require("./database");
const generated = require("./generated");

const cases = [
  ["Int", 42],
  ["BigInt", "42"],
  ["BigInt", "9007199254740991"],
  ["BigInt", "9007199254740993"],
  ["Bit", true],
  ["Bit", false],
  ["Decimal18", 12.34],
  ["Decimal38", 1],
  ["Float", 12345.678901234],
  ["VarChar100", "Español ñ á"],
  ["VarChar100", ""],
  ["VarCharMax", "x".repeat(10000)],
  ["NVarChar100", "Español ñ 😀 東京"],
  ["NVarChar100", ""],
  ["NVarCharMax", "😀".repeat(2000)],
  ["Date", new Date("2026-10-02T00:00:00.000Z")],
  ["DateTime", new Date("2026-10-02T12:34:56.123Z")],
  ["DateTime2", new Date("2026-10-02T12:34:56.123Z")],
  ["UniqueIdentifier", "5cbd5240-fcca-4831-9ff2-73664a9cd71d"],
  ["VarBinaryMax", Buffer.from([0, 1, 2, 127, 128, 255])],
];

function equal(actual, expected, label) {
  if (Buffer.isBuffer(expected)) {
    assert.ok(Buffer.isBuffer(actual) && actual.equals(expected), label);
  } else if (expected instanceof Date) {
    assert.ok(actual instanceof Date, label);
    assert.equal(actual.toISOString(), expected.toISOString(), label);
  } else if (label.startsWith("UniqueIdentifier:")) {
    assert.equal(actual.toLowerCase(), expected.toLowerCase(), label);
  } else {
    assert.equal(actual, expected, label);
  }
}

async function main() {
  for (const [name, value] of cases) {
    const execute = generated[`autobd_types_Test${name}`];
    const result = await execute({
      Value: value,
      Optional: null,
      Output: value,
    });
    assert.equal(result.recordset.length, 1, `${name}: SELECT row`);
    equal(result.recordset[0].Value, value, `${name}: SELECT value`);
    equal(result.output.Output, value, `${name}: OUTPUT value`);
    assert.equal(
      result.recordset[0].OptionalValue,
      null,
      `${name}: nullable parameter`,
    );
    assert.equal(result.recordset[0].NullValue, null, `${name}: NULL SELECT`);
    console.log(`PASS ${name} value/nullable/OUTPUT/SELECT/NULL`);
  }
  for (const name of new Set(cases.map(([item]) => item))) {
    const result = await generated[`autobd_types_Test${name}`]({ Value: null });
    assert.equal(result.recordset[0].Value, null, `${name}: NULL input`);
    assert.equal(result.recordset[0].OptionalValue, null, `${name}: omitted DEFAULT`);
    assert.equal(result.output.Output, null, `${name}: NULL output`);
    console.log(`PASS ${name} NULL input/output`);
  }
  const defaultResult = await generated.autobd_types_TestDefaultInt();
  assert.equal(defaultResult.recordset[0].Value, 7);
  console.log("PASS INT DEFAULT omitted");

  const decimal18 = await generated.autobd_types_TestDecimal18({
    Value: "1234567890123456.78",
  });
  assert.notEqual(decimal18.recordset[0].ExactText, "1234567890123456.78");
  console.log(
    `PARTIAL DECIMAL(18,2) precision: SQL stored ${decimal18.recordset[0].ExactText}`,
  );
  await assert.rejects(
    generated.autobd_types_TestDecimal38({
      Value: "12345678901234567890.123456789012345678",
    }),
    /could not be validated/,
  );
  console.log(
    "PARTIAL DECIMAL(38,18) high precision: input rejected by driver",
  );
  const time = await generated.autobd_types_TestDateTime2Literal();
  assert.equal(
    time.recordset[0].Value.toISOString(),
    "2026-10-02T12:34:56.123Z",
  );
  console.log("PARTIAL DATETIME2(7): SQL .1234567, JS Date .123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => database.close());

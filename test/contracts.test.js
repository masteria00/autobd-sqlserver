const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveProcedureContracts } = require("../src/generator");

test("reports every selected unmappable procedure", () => {
  const procedures = ["First", "Second"].map((name) => ({
    schema: "dbo",
    name,
    columns: [],
  }));
  const metadata = {
    procedureContracts: new Map(),
    procedureResults: new Map(),
    procedureResultErrors: new Map([
      [
        "dbo\u0000first",
        [{ number: 11526, type: "TEMPORARY_TABLE", message: "Uses #temp" }],
      ],
      [
        "dbo\u0000second",
        [{ number: 208, type: "SYNTAX", message: "Invalid object name" }],
      ],
    ]),
  };

  const { failures } = resolveProcedureContracts(
    metadata,
    { procedures },
    { strict: false },
  );
  assert.deepEqual(
    failures.map((item) => item.procedure),
    ["dbo.First", "dbo.Second"],
  );
  assert.match(failures[0].reason, /AutoBD.ResultContract/);
  assert.match(failures[1].reason, /fix the SQL procedure/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  GENERATED_HEADER,
  assertConsumerOutput,
  assertGeneratedTarget,
  prepareOutputDirectory,
} = require("../src/outputSafety");

function testDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "autobd-output-"));
  t.after(() => {
    if (path.dirname(directory) !== os.tmpdir()) {
      throw new Error(`Unsafe test cleanup path: ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test("full generation removes only AutoBD files", (t) => {
  const project = testDirectory(t);
  const output = path.join(project, "generated");
  const procedures = path.join(output, "dbo", "procedures");
  fs.mkdirSync(procedures, { recursive: true });
  const generated = path.join(procedures, "Old.auto.js");
  const custom = path.join(procedures, "Custom.auto.js");
  fs.writeFileSync(generated, `${GENERATED_HEADER}\nold code`);
  fs.writeFileSync(custom, "// Hand-written code\n");
  fs.writeFileSync(path.join(output, "notes.txt"), "keep me");

  assertConsumerOutput(project, output);
  prepareOutputDirectory(output, "full");

  assert.equal(fs.existsSync(generated), false);
  assert.equal(fs.readFileSync(custom, "utf8"), "// Hand-written code\n");
  assert.equal(
    fs.readFileSync(path.join(output, "notes.txt"), "utf8"),
    "keep me",
  );
});

test("AutoBD refuses to overwrite a hand-written file", (t) => {
  const directory = testDirectory(t);
  const file = path.join(directory, "index.js");
  fs.writeFileSync(file, "module.exports = {};\n");
  assert.throws(() => assertGeneratedTarget(file), /non-generated file/);
  assert.equal(fs.readFileSync(file, "utf8"), "module.exports = {};\n");

  fs.writeFileSync(file, `${GENERATED_HEADER}\nmodule.exports = {};\n`);
  assert.doesNotThrow(() => assertGeneratedTarget(file));
});

test("output must remain inside the consumer project", (t) => {
  const project = testDirectory(t);
  assert.throws(
    () => assertConsumerOutput(project, project),
    /inside the consumer/,
  );
  assert.throws(
    () =>
      assertConsumerOutput(project, path.join(project, "node_modules", "auto")),
    /outside node_modules/,
  );
  assert.throws(
    () => assertConsumerOutput(project, path.dirname(project)),
    /inside the consumer/,
  );
  assert.doesNotThrow(() =>
    assertConsumerOutput(project, path.join(project, "auto")),
  );
});

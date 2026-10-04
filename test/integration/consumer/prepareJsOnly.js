const fs = require("node:fs");
const path = require("node:path");

const target = path.join(__dirname, "js-only");
fs.mkdirSync(target, { recursive: true });
fs.cpSync(path.join(__dirname, "generated"), path.join(target, "generated"), {
  recursive: true,
  force: true,
  filter: (source) =>
    fs.statSync(source).isDirectory() || source.endsWith(".js"),
});
fs.copyFileSync(
  path.join(__dirname, "database.js"),
  path.join(target, "database.js"),
);
fs.copyFileSync(
  path.join(__dirname, "database.d.ts"),
  path.join(target, "database.d.ts"),
);
fs.copyFileSync(
  path.join(__dirname, "jsdoc-check.js"),
  path.join(target, "jsdoc-check.js"),
);

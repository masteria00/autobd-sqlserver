#!/usr/bin/env node

const { main } = require("../src/generator");

const [command] = process.argv.slice(2);
if (command !== "generate") {
  console.error(
    "Usage: autobd generate [--config path] [--profile name | --procedure schema.name]",
  );
  process.exitCode = 1;
} else {
  main().catch((error) => {
    console.error(`AutoBD generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

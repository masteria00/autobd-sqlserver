# AutoBD SQL Server

Generate CommonJS JavaScript or TypeScript wrappers for SQL Server stored procedures, tables, views and table-valued parameters.

Requires Node.js 22 or newer.

## First use (including AI agents)

AutoBD reads metadata from an **existing, reachable SQL Server database**. Before generating an API, provide the database connection through `DB_USER`, `DB_PASSWORD`, `DB_SERVER`, `DB_DATABASE`, and `DB_PORT`, and identify the stored procedures the API should expose. AutoBD generates wrappers; it does not create the database or decide the API's routes and business rules.

## Installation from the repository

Until the package is published to npm, install a packed tarball. Download or clone this repository from GitHub, then run these commands from the repository root, where `package.json` is located:

```sh
npm ci
npm test
npm pack
```

For version `0.1.0`, `npm pack` creates `autobd-sqlserver-0.1.0.tgz`. Use the filename printed by the command if the version changes.

Next, open a terminal in your API project, where its own `package.json` is located. If it is a new project without a manifest, run `npm init -y` first. Install the tarball using its actual path, and install `mssql` as a direct runtime dependency because the consumer's `database.js` and generated wrappers import it:

```sh
npm install "<path-to-autobd-sqlserver-0.1.0.tgz>" mssql
```

Replace the path placeholder; do not copy the angle brackets literally. For example, if you copied the tarball into the API project:

```sh
npm install ./autobd-sqlserver-0.1.0.tgz mssql
```

Installing the package provides the local `autobd` CLI; use it through the npm scripts below. Running `npm ci` in this repository prepares the generator for development, but does not install it in the API project. To update the installed generator after a source change, create a new tarball with `npm pack` and reinstall it in the consumer project.

After publication to npm, consumers can instead install the published package with `npm install autobd-sqlserver mssql`. Uploading the repository to GitHub does not publish it to npm.

## Consumer setup and generation

Create `config.autobd.json` and `database.js` in the project using the examples below. Add these scripts to the project's `package.json` so the installed local CLI works on Windows, macOS, and Linux:

```json
{
  "scripts": {
    "autoBD": "autobd generate --config config.autobd.json",
    "autoBD:sp": "autobd generate --config config.autobd.json --procedure"
  }
}
```

Set the `DB_*` environment variables, then run `npm run autoBD` for the first full generation. Check `logs.directory/autoBD-last-run.json` before using the generated functions. This README also covers later regeneration of individual procedures; an AI using AutoBD should follow the same steps.

The command runs in the consumer project. It reads `config.autobd.json` from the current directory unless `--config` points to another file. Relative paths in the configuration resolve from the configuration file's directory. If a procedure cannot be mapped, AutoBD reports its name and cause, skips its wrapper, and continues generating the other objects. This completes with exit code 0 and `status: "partial"` in the run report. Configuration, connection, and file-generation errors still stop the command with a nonzero exit code.

For one changed procedure, run `npm run autoBD:sp -- dbo.ProcedureName`. This overrides the default profile with incremental generation, selects only that SP, and includes required TVPs. Do not combine `--procedure` with `--profile`. For several changed objects, use targeted runs or an incremental profile. If a procedure was renamed or deleted, run the full profile so its former wrapper is removed. Use `npm run autoBD` when the complete output should be rebuilt.

## Connection and runtime

Set `DB_USER`, `DB_PASSWORD`, `DB_SERVER`, `DB_DATABASE`, and `DB_PORT` in the command environment. `DB_ENCRYPT=false` disables encryption; `DB_TRUST_SERVER_CERTIFICATE=true` accepts a local test certificate. Keep credentials outside the config and out of version control.

For a local SQL Server with a self-signed certificate, set `"connection": { "trustServerCertificate": true }` in the project config. This should be an explicit choice of the consumer.

Example configuration:

```json
{
  "defaultProfile": "full",
  "language": "js",
  "output": { "directory": "./generated/db", "groupBySchema": true },
  "runtime": { "databaseModule": "./database" },
  "logs": { "directory": "./autobd-logs" },
  "profiles": {
    "full": {
      "mode": "full",
      "include": { "schemas": ["dbo"] }
    }
  }
}
```

`runtime.databaseModule` is the consumer's CommonJS module used by generated procedures. It must export `using(callback)`, where the callback receives an `mssql` connection pool. AutoBD uses its own connection only to inspect SQL metadata. The consumer owns the runtime pool and its lifecycle.

For TypeScript output, provide a matching `.d.ts` for that runtime module. Its `using` method should type the callback pool as `sql.ConnectionPool`. Install the compiler and types in the consumer project:

```sh
npm install --save-dev typescript @types/node @types/mssql
```

Example `database.js`:

```js
const sql = require("mssql");

const pool = new sql.ConnectionPool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: Number(process.env.DB_PORT),
  options: { encrypt: true, trustServerCertificate: true },
});

module.exports = {
  async using(callback) {
    if (!pool.connected) await pool.connect();
    return callback(pool);
  },
  async close() {
    await pool.close();
  },
};
```

Generated procedure functions return `{ recordset, recordsets, output, returnValue, rowsAffected }`. Calls use parameterized `mssql` requests. Omit an optional input or pass `undefined` to let SQL Server apply its default; pass `null` to send SQL NULL.

When SQL Server cannot describe a procedure result, attach an `AutoBD.ResultContract` JSON extended property to the procedure. The same contract declares multiple resultsets, variants, and `optionalParameters`. For example, a procedure with an `iMode` default and one `int` column can use `{"optionalParameters":["iMode"],"variants":[{"resultSets":[{"columns":[{"name":"iValue","sqlType":"int","isNullable":false}]}]}]}`. Store the property beside the procedure in SQL Server, using `sys.sp_addextendedproperty` or `sys.sp_updateextendedproperty`.

The last run is written to `logs.directory/autoBD-last-run.json`. Confirm that every requested procedure appears in `generated.procedures`; if one appears in `skippedProcedures`, its wrapper was not regenerated even when the command exited with code 0. Partial runs and fatal failures **after configuration is loaded** also update `autoBD-last-failure.json`, including every skipped procedure and its cause. A missing or invalid config is printed to the console with a nonzero exit code because the log directory is not yet known. A partial full run excludes invalid wrappers from the regenerated output; a partial incremental run removes stale wrappers for its failed selected procedures. Full generation deletes only files bearing AutoBD's generated marker and refuses to overwrite hand-written files. Generated wrappers and reports are written in the consumer project, never inside this package.

## Precision limits verified against SQL Server

`BIGINT` is mapped to a decimal string, including values above `Number.MAX_SAFE_INTEGER`. `DECIMAL`/`NUMERIC` currently use `mssql`/Tedious numeric binding and a JavaScript `number` for result columns and OUTPUT parameters. High-precision values can be rounded before SQL Server receives them or when they are read back; `DECIMAL(38,18)` can also be rejected by the driver. Do not use these wrappers for exact high-precision amounts without validating the value and contract separately. A stored procedure can explicitly return `CONVERT(VARCHAR(...), DecimalColumn)` when an exact textual SELECT value is required. `DATETIME2(4..7)` results are exposed as JavaScript `Date` values and retain only milliseconds.

## Contributing

Work from the repository root and follow [AGENTS.md](AGENTS.md) and the [engineering principles](docs/engineering-principles.md). Run `npm ci` and `npm test` for package changes; follow AGENTS.md for the additional SQL Server integration checks required by generator changes. Contributor guides and tests are available in the repository; the npm tarball contains the runtime package and consumer documentation.

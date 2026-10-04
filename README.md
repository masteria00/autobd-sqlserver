# AutoBD SQL Server

Generate CommonJS JavaScript or TypeScript wrappers for SQL Server stored procedures, tables, views and table-valued parameters.

Requires Node.js 22 or newer.

## First use (including AI agents)

AutoBD reads metadata from an **existing, reachable SQL Server database** and generates JavaScript or TypeScript functions for its stored procedures. It does not create the database, procedures, API routes, or business rules.

The usual flow is:

1. Install AutoBD in your API project and provide a SQL Server connection.
2. Choose which procedures to generate in `config.autobd.json`.
3. Run the generator and check its report for skipped procedures.
4. Import a generated function and call it with the procedure's parameters.

The examples below use illustrative procedures named `dbo.GetCustomerById`, `dbo.ListCustomers`, and `dbo.CreateCustomer`. They work only if your SQL Server database contains procedures with those names and parameter shapes. Replace the example names and parameters with procedures from your database.

## Installation from the repository

Until the package is published to npm, install a packed tarball. Download or clone this repository from GitHub, then run these commands from the repository root, where `package.json` is located:

```sh
npm ci
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

Installing the package provides the local `autobd` CLI; use it through the npm scripts below. Running `npm ci` in the repository installs the dependencies needed to create the tarball; it does not install AutoBD in the API project. To update the installed generator after a source change, create a new tarball with `npm pack` and reinstall it in the consumer project.

After publication to npm, consumers can instead install the published package with `npm install autobd-sqlserver mssql`. Uploading the repository to GitHub does not publish it to npm.

## Consumer setup and generation

Create `config.autobd.json` and `database.js` in the API project using the examples below. Add these scripts to the project's `package.json` so the installed local CLI works on Windows, macOS, and Linux:

```json
{
  "scripts": {
    "autoBD": "autobd generate --config config.autobd.json",
    "autoBD:sp": "autobd generate --config config.autobd.json --procedure"
  }
}
```

Set the `DB_*` environment variables, then run `npm run autoBD` for the first full generation. Check `logs.directory/autoBD-last-run.json` before using the generated functions.

### Choose what to generate

This example generates procedures in the `dbo` schema as JavaScript and puts the wrappers in `generated/`:

```json
{
  "defaultProfile": "full",
  "language": "js",
  "output": { "directory": "./generated", "groupBySchema": true },
  "runtime": { "databaseModule": "./database" },
  "logs": { "directory": "./logs" },
  "profiles": {
    "full": {
      "mode": "full",
      "include": {
        "procedures": ["dbo.GetCustomerById", "dbo.ListCustomers", "dbo.CreateCustomer"]
      }
    }
  }
}
```

Use exact schema-qualified SQL procedure names in `include.procedures`. You can instead select a schema with `"schemas": ["dbo"]`; this includes eligible tables and views from that schema too. Choose `"language": "both"` to generate JavaScript and TypeScript output. The default language, when omitted, is JavaScript.

Put the metadata connection settings in environment variables rather than in the config file. For example, in PowerShell:

```powershell
$env:DB_USER = "your_user"
$env:DB_PASSWORD = "your_password"
$env:DB_SERVER = "localhost"
$env:DB_DATABASE = "your_database"
$env:DB_PORT = "1433"
npm run autoBD
```

After generation, inspect `logs/autoBD-last-run.json`. Make sure every requested procedure appears under `generated.procedures`; an entry under `skippedProcedures` has no current wrapper.

### Call a generated procedure

With the example output directory and `dbo` schema, AutoBD creates `generated/index.js`, which re-exports generated functions. The public function name combines the schema and procedure name, replacing characters that are invalid in JavaScript identifiers with underscores. For example, `dbo.GetCustomerById` becomes `dbo_GetCustomerById`:

```js
const { dbo_GetCustomerById } = require("./generated");

async function showCustomer(id) {
  const result = await dbo_GetCustomerById({ CustomerId: id });
  return result.recordset[0] ?? null;
}
```

Pass procedure inputs as an object whose property names match the SQL parameter names without the `@` prefix. The wrapper executes the original schema-qualified procedure name with parameterized `mssql` inputs. It resolves to an object containing `recordset`, `recordsets`, `output`, `returnValue`, and `rowsAffected`. For a query returning rows, `recordset` is the first result set. A lookup usually reads its first row, while a list can return all rows:

```js
const { dbo_ListCustomers } = require("./generated");

async function listCustomers() {
  const { recordset } = await dbo_ListCustomers();
  return recordset;
}
```

For a create procedure, SQL Server determines what comes back. If it returns the created row with `SELECT`, read `recordset[0]`. If it uses output parameters, read `result.output`. If it returns no rows, check `result.rowsAffected` or `result.returnValue`, depending on the procedure:

```js
const { dbo_CreateCustomer } = require("./generated");

async function createCustomer(name) {
  const result = await dbo_CreateCustomer({ Name: name });
  return { customer: result.recordset[0] ?? null, rowsAffected: result.rowsAffected };
}
```

This example assumes `dbo.CreateCustomer` accepts `@Name`. Adapt the call to the real procedure. If it returns output parameters, read them from `result.output`. Omit an optional input, or pass `undefined`, to let SQL Server apply its default; pass `null` when you intend SQL NULL.

Call wrappers from your existing application code. A framework route can call a small function like `showCustomer` or `createCustomer`; AutoBD does not create API routes.

For TypeScript output, import from `./generated` in a `.ts` file. AutoBD generates typed procedure functions and result shapes from SQL Server metadata or a configured result contract.

Run the command from the API project, where `config.autobd.json` is located. If a procedure cannot be mapped, AutoBD records its name and reason, skips that wrapper, and continues with other objects. The run report shows `status: "partial"`; check it even when the command exits successfully. Invalid configuration, connection, or file-generation errors stop the command with a nonzero exit code.

To regenerate one changed procedure and its required TVPs, run `npm run autoBD:sp -- dbo.ProcedureName`, using its exact SQL schema and name. Run `npm run autoBD` to rebuild the full selection, including after renaming or deleting a procedure. Do not combine `--procedure` with `--profile`.

## Connection and runtime

Set `DB_USER`, `DB_PASSWORD`, `DB_SERVER`, `DB_DATABASE`, and `DB_PORT` in the command environment. `DB_ENCRYPT=false` disables encryption; `DB_TRUST_SERVER_CERTIFICATE=true` accepts a local test certificate. Keep credentials outside the config and out of version control.

For a local SQL Server with a self-signed certificate, set `"connection": { "trustServerCertificate": true }` in the project config. This should be an explicit choice of the consumer.

`runtime.databaseModule` points to the API project's CommonJS connection module. It must export `using(callback)`, which passes the consumer's `mssql` connection pool to generated functions. AutoBD uses its own metadata connection while generating; generated functions use the consumer's pool shown in `database.js` below.

For TypeScript output, provide a matching `.d.ts` for the runtime module, with the callback pool typed as `sql.ConnectionPool`. Install the compiler and types in the consumer project:

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

Generated procedure functions return `{ recordset, recordsets, output, returnValue, rowsAffected }` and use parameterized `mssql` requests. For optional SQL parameters, omit the property or pass `undefined` to use the SQL default; pass `null` to send SQL NULL.

Most procedures are described directly from SQL Server metadata. If SQL Server cannot describe a procedure's result, an `AutoBD.ResultContract` extended property can declare its result columns, variants, and optional parameters. Add or update it with `sys.sp_addextendedproperty` or `sys.sp_updateextendedproperty`.

The run report is written to the configured logs directory. Confirm that requested procedures appear in `generated.procedures` and not in `skippedProcedures`. On a partial run, AutoBD also writes a failure report with the reason for each skipped procedure. Full generation removes only AutoBD-generated files and refuses to overwrite hand-written files. Wrappers and reports are written in the API project, never inside this package.

## Precision limits verified against SQL Server

`BIGINT` is mapped to a decimal string, including values above `Number.MAX_SAFE_INTEGER`. `DECIMAL`/`NUMERIC` currently use `mssql`/Tedious numeric binding and a JavaScript `number` for result columns and OUTPUT parameters. High-precision values can be rounded before SQL Server receives them or when they are read back; `DECIMAL(38,18)` can also be rejected by the driver. Do not use these wrappers for exact high-precision amounts without validating the value and contract separately. A stored procedure can explicitly return `CONVERT(VARCHAR(...), DecimalColumn)` when an exact textual SELECT value is required. `DATETIME2(4..7)` results are exposed as JavaScript `Date` values and retain only milliseconds.

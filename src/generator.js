const fs = require("fs");
const path = require("path");
const {
  database_query_models,
  database_query_model_sp,
  database_query_store_procedure,
  database_query_procedure_contracts,
  database_query_tvps,
  renderProcedureJS,
  renderProcedureTS,
  renderModelJS,
  renderModelTS,
  renderTvpJS,
  renderTvpTS,
  getObjectIdentifier,
  getJsType,
} = require("./databaseProperties");
const { createDatabase } = require("./connection");
const {
  GENERATED_HEADER,
  assertConsumerOutput,
  assertGeneratedTarget,
  isGeneratedFile,
  prepareOutputDirectory,
} = require("./outputSafety");

const generatedFiles = new Set();

async function main() {
  const config = loadConfig();
  const database = createDatabase(config.connection);
  let procedureFailures = [];

  try {
    const metadata = await readMetadata(database);
    const selection = selectMetadata(metadata, config);
    validateExplicitTargets(metadata, config, selection);
    if (config.targetProcedure && selection.procedures.length !== 1) {
      throw new Error(
        `Procedure ${config.targetProcedure} is excluded by the configuration`,
      );
    }
    const selectedProcedures = selection.procedures;
    const { resultSpecs, failures: contractFailures } =
      resolveProcedureContracts(metadata, selection, config);
    const invalidContracts = new Set(
      contractFailures.map((item) => item.procedure.toLowerCase()),
    );
    selection.procedures = selectedProcedures.filter(
      (procedure) =>
        !invalidContracts.has(
          `${procedure.schema}.${procedure.name}`.toLowerCase(),
        ),
    );
    const dependencyFailures = resolveProcedureDependencies(
      metadata,
      selection,
      config,
    );
    procedureFailures = [...contractFailures, ...dependencyFailures];
    const failedSelected = selectedProcedures.filter((procedure) =>
      procedureFailures.some(
        (item) =>
          item.procedure.toLowerCase() ===
          `${procedure.schema}.${procedure.name}`.toLowerCase(),
      ),
    );

    validateGeneratedNameCollisions(metadata, selection);

    const databaseModulePath = path.resolve(
      config.projectRoot,
      config.runtime.databaseModule,
    );
    if (
      !fs.existsSync(databaseModulePath) &&
      !fs.existsSync(`${databaseModulePath}.js`) &&
      !fs.existsSync(`${databaseModulePath}.ts`)
    ) {
      throw new Error(
        `Runtime database module not found: ${databaseModulePath}`,
      );
    }
    const outputDir = path.resolve(config.projectRoot, config.output.directory);
    assertConsumerOutput(config.projectRoot, outputDir);
    prepareOutputDirectory(outputDir, config.mode);
    if (config.mode === "incremental")
      removeFailedProcedureFiles(outputDir, failedSelected);

    generatedFiles.clear();
    const report = generateFiles(outputDir, selection, resultSpecs, config);
    report.skippedProcedures = failedSelected.map(
      (procedure) => `${procedure.schema}.${procedure.name}`,
    );
    rebuildIndexes(outputDir, config.language);
    await formatGeneratedFiles(config);
    printReport(config, report, procedureFailures);
    writeRunReport(
      config,
      procedureFailures.length ? "partial" : "success",
      procedureFailures,
      report,
    );
    return report;
  } catch (error) {
    writeRunReport(config, "failed", [
      ...procedureFailures,
      ...(error.failures ?? [{ procedure: null, reason: error.message }]),
    ]);
    throw error;
  } finally {
    await database.close();
  }
}

function writeRunReport(config, status, failures, report = null) {
  const runReportPath = path.resolve(
    config.projectRoot,
    config.logs.directory,
    "autoBD-last-run.json",
  );
  const failureReportPath = path.resolve(
    config.projectRoot,
    config.logs.directory,
    "autoBD-last-failure.json",
  );
  fs.mkdirSync(path.dirname(runReportPath), { recursive: true });
  const content = `${JSON.stringify({ timestamp: new Date().toISOString(), profile: config.profileName ?? "default", status, generated: report, failures }, null, 2)}\n`;
  fs.writeFileSync(runReportPath, content);
  if (status !== "success") fs.writeFileSync(failureReportPath, content);
}

function loadConfig() {
  const configPath = path.resolve(
    process.cwd(),
    readOption("--config") ?? "config.autobd.json",
  );
  if (!fs.existsSync(configPath))
    throw new Error(`AutoBD config not found: ${configPath}`);
  const projectRoot = path.dirname(configPath);
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));

  const targetProcedure = readOption("--procedure");
  const requestedProfile = readProfileArgument();
  if (targetProcedure && requestedProfile) {
    throw new Error("Use either --procedure or --profile, not both.");
  }
  if (
    targetProcedure &&
    (!targetProcedure.includes(".") ||
      targetProcedure.startsWith(".") ||
      targetProcedure.endsWith(".") ||
      targetProcedure.includes("*"))
  ) {
    throw new Error(
      "--procedure requires an exact schema-qualified name, such as dbo.CreateOrder.",
    );
  }

  const profileName = targetProcedure
    ? null
    : (requestedProfile ?? raw.defaultProfile ?? null);
  const profile = profileName ? raw.profiles?.[profileName] : null;

  if (profileName && !profile) {
    throw new Error(`AutoBD profile not found: ${profileName}`);
  }

  const merged = mergeConfig(raw, profile ?? {});
  const config = {
    projectRoot,
    profileName: targetProcedure ? `procedure:${targetProcedure}` : profileName,
    targetProcedure,
    mode: targetProcedure ? "incremental" : (merged.mode ?? "full"),
    language: merged.language ?? "js",
    include: normalizeFilter(
      targetProcedure ? { procedures: [targetProcedure] } : merged.include,
    ),
    exclude: normalizeFilter(merged.exclude),
    dependencies: merged.dependencies ?? "auto",
    strict: targetProcedure ? false : (merged.strict ?? false),
    output: {
      directory: merged.output?.directory ?? "./generated/auto",
      groupBySchema: merged.output?.groupBySchema ?? true,
    },
    runtime: {
      databaseModule: merged.runtime?.databaseModule ?? "./database",
    },
    logs: {
      directory: merged.logs?.directory ?? "./autobd-logs",
    },
    connection: merged.connection ?? {},
    formatter: {
      enabled: merged.formatter?.enabled ?? true,
      command: merged.formatter?.command ?? "prettier",
    },
    report: merged.report ?? true,
  };

  if (!["full", "incremental"].includes(config.mode)) {
    throw new Error(
      `Invalid AutoBD mode: ${config.mode}. Expected full or incremental.`,
    );
  }
  if (!["js", "ts", "both"].includes(config.language)) {
    throw new Error(
      `Invalid AutoBD language: ${config.language}. Expected js, ts or both.`,
    );
  }
  if (config.dependencies !== "auto") {
    throw new Error(
      `Invalid dependencies mode: ${config.dependencies}. Only "auto" is currently supported.`,
    );
  }
  if (config.output.groupBySchema !== true) {
    throw new Error("output.groupBySchema=false is not supported yet.");
  }
  if (config.formatter.enabled && config.formatter.command !== "prettier") {
    throw new Error("Only the built-in prettier formatter is supported.");
  }

  return config;
}

function mergeConfig(root, profile) {
  const base = { ...root };
  delete base.profiles;
  delete base.defaultProfile;

  return {
    ...base,
    ...profile,
    include: { ...(base.include ?? {}), ...(profile.include ?? {}) },
    exclude: { ...(base.exclude ?? {}), ...(profile.exclude ?? {}) },
    output: { ...(base.output ?? {}), ...(profile.output ?? {}) },
    runtime: { ...(base.runtime ?? {}), ...(profile.runtime ?? {}) },
    logs: { ...(base.logs ?? {}), ...(profile.logs ?? {}) },
    connection: { ...(base.connection ?? {}), ...(profile.connection ?? {}) },
    formatter: { ...(base.formatter ?? {}), ...(profile.formatter ?? {}) },
  };
}

function normalizeFilter(value = {}, fallback = {}) {
  return {
    schemas: normalizePatterns(value.schemas ?? fallback.schemas ?? []),
    procedures: normalizePatterns(
      value.procedures ?? fallback.procedures ?? [],
    ),
    tables: normalizePatterns(value.tables ?? fallback.tables ?? []),
    views: normalizePatterns(value.views ?? fallback.views ?? []),
    tvps: normalizePatterns(value.tvps ?? fallback.tvps ?? []),
  };
}

function normalizePatterns(value) {
  if (value == null) return [];
  if (!Array.isArray(value))
    throw new Error("AutoBD include/exclude values must be arrays.");
  return value.map(String);
}

function readProfileArgument() {
  return readOption("--profile");
}

function readOption(name) {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      const value = args[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${name} requires a value.`);
      return value;
    }
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return null;
}

async function readMetadata(database) {
  return database.withNewConnection(async (pool) => {
    const [
      procedureResult,
      procedureParams,
      modelResult,
      tvpResult,
      contractResult,
    ] = await Promise.all([
      runMetadataQuery(
        pool,
        "stored procedure result metadata",
        database_query_model_sp,
      ),
      runMetadataQuery(
        pool,
        "stored procedure parameter metadata",
        database_query_store_procedure,
      ),
      runMetadataQuery(pool, "table/view metadata", database_query_models),
      runMetadataQuery(
        pool,
        "table-valued parameter metadata",
        database_query_tvps,
      ),
      runMetadataQuery(
        pool,
        "stored procedure result contracts",
        database_query_procedure_contracts,
      ),
    ]);

    const procedures = groupMetadata(procedureParams.recordset, "procedure");
    const { results: procedureResults, errors: procedureResultErrors } =
      groupProcedureResults(procedureResult.recordset);
    const models = groupModels(modelResult.recordset);
    const tvps = groupMetadata(tvpResult.recordset, "tvp");

    return {
      procedures,
      procedureResults,
      procedureResultErrors,
      procedureContracts: new Map(
        contractResult.recordset.map((row) => [
          objectKey(row.SchemaName, row.Name),
          row.ContractJson,
        ]),
      ),
      tables: models.filter((item) => item.kind === "table"),
      views: models.filter((item) => item.kind === "view"),
      tvps,
    };
  });
}

async function runMetadataQuery(pool, label, query) {
  try {
    return await pool.request().query(query);
  } catch (error) {
    const wrapped = new Error(`Failed reading ${label}: ${error.message}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function groupMetadata(rows, kind) {
  const objects = new Map();
  for (const row of rows ?? []) {
    const key = objectKey(row.SchemaName, row.Name);
    let object = objects.get(key);
    if (!object) {
      object = { schema: row.SchemaName, name: row.Name, kind, columns: [] };
      objects.set(key, object);
    }
    if (row.ColumnName !== null && row.ColumnName !== undefined) {
      object.columns.push(toColumn(row));
    }
  }
  return [...objects.values()];
}

function groupModels(rows) {
  const objects = new Map();
  for (const row of rows ?? []) {
    const key = objectKey(row.SchemaName, row.Name);
    let object = objects.get(key);
    if (!object) {
      object = {
        schema: row.SchemaName,
        name: row.Name,
        kind: row.ObjectKind,
        columns: [],
      };
      objects.set(key, object);
    }
    object.columns.push(toColumn(row));
  }
  return [...objects.values()];
}

function groupProcedureResults(rows) {
  const objects = new Map();
  const errors = new Map();
  for (const row of rows ?? []) {
    const key = objectKey(row.SchemaName, row.Name);
    if (row.ErrorNumber) {
      const messages = errors.get(key) ?? [];
      messages.push({
        number: row.ErrorNumber,
        type: row.ErrorTypeDesc,
        message: row.ErrorMessage,
      });
      errors.set(key, messages);
      continue;
    }
    let object = objects.get(key);
    if (!object) {
      object = {
        schema: row.SchemaName,
        name: row.Name,
        kind: "procedureResult",
        columns: [],
      };
      objects.set(key, object);
    }
    if (row.ColumnName !== null && row.ColumnName !== undefined)
      object.columns.push(toColumn(row));
  }
  return { results: objects, errors };
}

function toColumn(row) {
  return {
    name: row.ColumnName,
    sqlType: row.SqlTypeName,
    maxLength: row.MaxLength,
    precision: row.Precision,
    scale: row.Scale,
    isNullable: row.IsNullable === true || row.IsNullable === 1,
    isOutput: row.IsOutput === true || row.IsOutput === 1,
    isTableType: row.IsTableType === true || row.IsTableType === 1,
    typeSchema: row.TypeSchemaName ?? null,
    typeName: row.TypeName ?? null,
  };
}

function selectMetadata(metadata, config) {
  const selection = {
    procedures: selectObjects(metadata.procedures, "procedures", config),
    tables: selectObjects(metadata.tables, "tables", config),
    views: selectObjects(metadata.views, "views", config),
    tvps: selectObjects(metadata.tvps, "tvps", config),
    dependencyTvps: [],
  };
  return selection;
}

function selectObjects(objects, type, config) {
  return objects.filter(
    (object) =>
      isIncluded(object, type, config.include) &&
      !isExcluded(object, type, config.exclude),
  );
}

function isIncluded(object, type, include) {
  const hasAnyInclude = Object.values(include).some(
    (patterns) => patterns.length > 0,
  );
  if (!hasAnyInclude) return true;
  if (matchesAny(object.schema, include.schemas)) return true;
  return matchesObject(object, include[type]);
}

function isExcluded(object, type, exclude) {
  if (matchesAny(object.schema, exclude.schemas)) return true;
  return matchesObject(object, exclude[type]);
}

function matchesObject(object, patterns) {
  return patterns.some((pattern) => {
    const target = pattern.includes(".")
      ? `${object.schema}.${object.name}`
      : object.name;
    return wildcardMatch(target, pattern);
  });
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => wildcardMatch(value, pattern));
}

function wildcardMatch(value, pattern) {
  const regex = new RegExp(
    `^${escapeRegex(pattern).replaceAll("\\*", ".*")}$`,
    "i",
  );
  return regex.test(value);
}

function escapeRegex(value) {
  return String(value)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "\\*");
}

function validateExplicitTargets(metadata, config) {
  const checks = [
    ["schemas", uniqueSchemas(metadata)],
    ["procedures", metadata.procedures],
    ["tables", metadata.tables],
    ["views", metadata.views],
    ["tvps", metadata.tvps],
  ];

  for (const [type, source] of checks) {
    for (const pattern of config.include[type]) {
      if (pattern.includes("*")) continue;
      const exists =
        type === "schemas"
          ? source.some(
              (schema) => schema.toLowerCase() === pattern.toLowerCase(),
            )
          : source.some((object) => {
              const expected = pattern.includes(".")
                ? `${object.schema}.${object.name}`
                : object.name;
              return expected.toLowerCase() === pattern.toLowerCase();
            });
      if (!exists)
        throw new Error(`AutoBD ${singular(type)} not found: ${pattern}`);
    }
  }
}

function resolveProcedureDependencies(metadata, selection, config) {
  const tvpByKey = new Map(
    metadata.tvps.map((tvp) => [objectKey(tvp.schema, tvp.name), tvp]),
  );
  const selectedKeys = new Set(
    selection.tvps.map((tvp) => objectKey(tvp.schema, tvp.name)),
  );
  const dependencyKeys = new Set();
  const validProcedures = [];
  const failures = [];

  for (const procedure of selection.procedures) {
    const requiredKeys = new Set();
    let reason = null;
    for (const parameter of procedure.columns.filter(
      (column) => column.isTableType,
    )) {
      const key = objectKey(parameter.typeSchema, parameter.typeName);
      const tvp = tvpByKey.get(key);
      if (!tvp) {
        reason = `TVP dependency not found: ${parameter.typeSchema}.${parameter.typeName}`;
        break;
      }
      if (isExcluded(tvp, "tvps", config.exclude)) {
        reason = `TVP dependency ${tvp.schema}.${tvp.name} is excluded`;
        break;
      }
      if (!selectedKeys.has(key)) requiredKeys.add(key);
    }
    if (reason) {
      failures.push({
        procedure: `${procedure.schema}.${procedure.name}`,
        reason,
      });
      continue;
    }
    validProcedures.push(procedure);
    for (const key of requiredKeys) dependencyKeys.add(key);
  }

  selection.procedures = validProcedures;
  selection.dependencyTvps = [...dependencyKeys].map((key) =>
    tvpByKey.get(key),
  );
  selection.tvps = [...selection.tvps, ...selection.dependencyTvps];
  return failures;
}

function resolveProcedureContracts(metadata, selection, config) {
  const resultSpecs = new Map();
  const failures = [];
  const procedures = config.strict ? metadata.procedures : selection.procedures;

  for (const procedure of procedures) {
    const key = objectKey(procedure.schema, procedure.name);
    const name = `${procedure.schema}.${procedure.name}`;
    const raw = metadata.procedureContracts.get(key);
    const errors = metadata.procedureResultErrors.get(key) ?? [];

    try {
      const contract = raw == null ? {} : JSON.parse(raw);
      if (
        !contract ||
        typeof contract !== "object" ||
        Array.isArray(contract)
      ) {
        throw new Error("AutoBD.ResultContract must be a JSON object");
      }

      const optionalParameters = contract.optionalParameters ?? [];
      if (
        !Array.isArray(optionalParameters) ||
        optionalParameters.some((item) => typeof item !== "string")
      ) {
        throw new Error(
          "optionalParameters must be an array of parameter names",
        );
      }
      const knownParameters = new Set(
        procedure.columns.map((column) =>
          column.name.replace(/^@/, "").toLowerCase(),
        ),
      );
      for (const parameter of optionalParameters) {
        if (!knownParameters.has(parameter.toLowerCase())) {
          throw new Error(`optional parameter ${parameter} does not exist`);
        }
      }

      let variants;
      let explicit = false;
      if (contract.variants !== undefined) {
        if (!Array.isArray(contract.variants) || !contract.variants.length) {
          throw new Error("variants must be a non-empty array");
        }
        explicit = true;
        variants = contract.variants.map((variant, variantIndex) => {
          if (!variant || !Array.isArray(variant.resultSets)) {
            throw new Error(
              `variant ${variantIndex + 1} must contain resultSets`,
            );
          }
          return {
            resultSets: variant.resultSets.map((set, setIndex) => {
              if (!set || !Array.isArray(set.columns) || !set.columns.length) {
                throw new Error(
                  `variant ${variantIndex + 1}, result set ${setIndex + 1} must contain columns`,
                );
              }
              const names = new Set();
              const columns = set.columns.map((column) => {
                if (
                  !column ||
                  typeof column.name !== "string" ||
                  !column.name.trim()
                ) {
                  throw new Error(
                    `variant ${variantIndex + 1}, result set ${setIndex + 1} has a column without a name`,
                  );
                }
                if (names.has(column.name.toLowerCase())) {
                  throw new Error(`duplicate result column ${column.name}`);
                }
                names.add(column.name.toLowerCase());
                if (typeof column.isNullable !== "boolean") {
                  throw new Error(
                    `result column ${column.name} requires boolean isNullable`,
                  );
                }
                getJsType(column);
                return {
                  name: column.name,
                  sqlType: column.sqlType,
                  isNullable: column.isNullable,
                };
              });
              return { columns };
            }),
          };
        });
      } else {
        const inferred = metadata.procedureResults.get(key);
        variants = [{ resultSets: inferred?.columns.length ? [inferred] : [] }];
      }

      const errorDetails = errors
        .map((item) => `SQL Server ${item.number}: ${item.message}`)
        .join("; ");
      const contractEligibleErrors = new Set([
        "TEMPORARY_TABLE",
        "CONFLICTING_RESULTS",
        "DYNAMIC_SQL",
      ]);
      if (errors.some((item) => !contractEligibleErrors.has(item.type))) {
        throw new Error(
          `${errorDetails}; fix the SQL procedure before generation`,
        );
      }
      if (errors.length && !explicit) {
        throw new Error(
          `${errorDetails}; add an AutoBD.ResultContract property with variants`,
        );
      }

      const inferred = metadata.procedureResults.get(key);
      if (explicit && inferred?.columns.length) {
        const matchesFirstResult = variants.some((variant) => {
          const first = variant.resultSets[0];
          return (
            first?.columns.length === inferred.columns.length &&
            first.columns.every(
              (column, index) =>
                column.name.toLowerCase() ===
                  inferred.columns[index].name.toLowerCase() &&
                column.sqlType.toLowerCase() ===
                  inferred.columns[index].sqlType.toLowerCase(),
            )
          );
        });
        if (!matchesFirstResult) {
          throw new Error(
            "AutoBD.ResultContract does not match the first result set described by SQL Server",
          );
        }
      }

      if (
        selection.procedures.some(
          (item) => objectKey(item.schema, item.name) === key,
        )
      ) {
        resultSpecs.set(key, {
          variants,
          explicit,
          optionalParameters: new Set(
            optionalParameters.map((item) => item.toLowerCase()),
          ),
        });
      }
    } catch (error) {
      failures.push({ procedure: name, reason: error.message });
    }
  }

  return { resultSpecs, failures };
}

function removeFailedProcedureFiles(outputDir, procedures) {
  for (const procedure of procedures) {
    for (const item of ["js", "ts"]) {
      const file = objectFile(outputDir, procedure, "procedures", item);
      assertGeneratedTarget(file);
      fs.rmSync(file, { force: true });
    }
  }
}

function generateFiles(outputDir, selection, resultSpecs, config) {
  const report = {
    procedures: [],
    tables: [],
    views: [],
    tvps: [],
    dependencyTvps: [],
  };
  const languages =
    config.language === "both" ? ["js", "ts"] : [config.language];

  for (const tvp of uniqueObjects(selection.tvps)) {
    for (const language of languages) {
      const file = objectFile(outputDir, tvp, "tvp", language);
      writeGenerated(
        file,
        language === "js" ? renderTvpJS(tvp) : renderTvpTS(tvp),
      );
    }
    const name = `${tvp.schema}.${tvp.name}`;
    report.tvps.push(name);
    if (
      selection.dependencyTvps.some(
        (item) =>
          objectKey(item.schema, item.name) === objectKey(tvp.schema, tvp.name),
      )
    ) {
      report.dependencyTvps.push(name);
    }
  }

  for (const table of selection.tables) {
    writeModelTargets(outputDir, table, "tables", languages);
    report.tables.push(`${table.schema}.${table.name}`);
  }

  for (const view of selection.views) {
    writeModelTargets(outputDir, view, "views", languages);
    report.views.push(`${view.schema}.${view.name}`);
  }

  for (const procedure of selection.procedures) {
    const resultSpec = resultSpecs.get(
      objectKey(procedure.schema, procedure.name),
    );
    for (const language of languages) {
      const file = objectFile(outputDir, procedure, "procedures", language);
      const dependencies = getProcedureDependencyImports(
        outputDir,
        file,
        procedure,
        selection.tvps,
        language,
      );
      const databaseModulePath = path.resolve(
        config.projectRoot,
        config.runtime.databaseModule,
      );
      const databaseRequirePath = relativeModulePath(
        path.dirname(file),
        databaseModulePath,
      );
      const content =
        language === "js"
          ? renderProcedureJS(
              procedure,
              resultSpec,
              dependencies,
              databaseRequirePath,
            )
          : renderProcedureTS(
              procedure,
              resultSpec,
              dependencies,
              databaseRequirePath,
            );
      writeGenerated(file, content);
    }
    report.procedures.push(`${procedure.schema}.${procedure.name}`);
  }

  return report;
}

function writeModelTargets(outputDir, model, folder, languages) {
  for (const language of languages) {
    const file = objectFile(outputDir, model, folder, language);
    writeGenerated(
      file,
      language === "js" ? renderModelJS(model) : renderModelTS(model),
    );
  }
}

function getProcedureDependencyImports(
  outputDir,
  procedureFile,
  procedure,
  selectedTvps,
  language,
) {
  const tvpMap = new Map(
    selectedTvps.map((tvp) => [objectKey(tvp.schema, tvp.name), tvp]),
  );
  const dependencies = [];
  const seen = new Set();
  for (const parameter of procedure.columns.filter(
    (column) => column.isTableType,
  )) {
    const key = objectKey(parameter.typeSchema, parameter.typeName);
    if (seen.has(key)) continue;
    seen.add(key);
    const tvp = tvpMap.get(key);
    if (!tvp)
      throw new Error(
        `Missing selected TVP ${parameter.typeSchema}.${parameter.typeName}`,
      );
    const tvpFile = objectFile(outputDir, tvp, "tvp", language);
    dependencies.push({
      tvp,
      requirePath: relativeModulePath(
        path.dirname(procedureFile),
        tvpFile.slice(0, -(language.length + 1)),
      ),
    });
  }
  return dependencies;
}

function rebuildIndexes(outputDir, language) {
  const languages = language === "both" ? ["js", "ts"] : [language];
  for (const lang of languages) {
    rebuildSchemaIndexes(outputDir, lang);
    rebuildRootIndex(outputDir, lang);
  }
}

function rebuildSchemaIndexes(outputDir, language) {
  for (const schemaDir of listDirectories(outputDir)) {
    const proceduresDir = path.join(outputDir, schemaDir, "procedures");
    const files = listGeneratedFiles(proceduresDir, language);
    const indexPath = path.join(outputDir, schemaDir, `index.${language}`);

    if (!files.length) {
      if (fs.existsSync(indexPath)) {
        assertGeneratedTarget(indexPath);
        fs.rmSync(indexPath);
      }
      continue;
    }

    const lines = files.map((file) => {
      const modulePath = `./procedures/${stripExtension(file, language)}`;
      return language === "js"
        ? `  ...require(${JSON.stringify(modulePath)})`
        : `export * from ${JSON.stringify(modulePath)};`;
    });

    const content =
      language === "js"
        ? `module.exports = {\n${lines.join(",\n")}\n};\n`
        : `${lines.join("\n")}\n`;
    writeGenerated(indexPath, content);
  }
}

function rebuildRootIndex(outputDir, language) {
  const schemaIndexes = listDirectories(outputDir).filter((schemaDir) =>
    fs.existsSync(path.join(outputDir, schemaDir, `index.${language}`)),
  );
  const tvpFiles = [];
  for (const schemaDir of listDirectories(outputDir)) {
    for (const file of listGeneratedFiles(
      path.join(outputDir, schemaDir, "tvp"),
      language,
    )) {
      tvpFiles.push({ schemaDir, file });
    }
  }

  let content;
  if (language === "js") {
    const schemaImports = schemaIndexes.map(
      (schemaDir, index) =>
        `const schema${index} = require(${JSON.stringify(`./${schemaDir}`)});`,
    );
    const tvpImports = tvpFiles.map(
      ({ schemaDir, file }, index) =>
        `const tvp${index} = require(${JSON.stringify(`./${schemaDir}/tvp/${stripExtension(file, language)}`)});`,
    );
    const schemaSpreads = schemaIndexes
      .map((_, index) => `  ...schema${index}`)
      .join(",\n");
    const tvpSpreads = tvpFiles
      .map((_, index) => `    ...tvp${index}`)
      .join(",\n");
    content = `${[...schemaImports, ...tvpImports].join("\n")}\n\nmodule.exports = {\n${schemaSpreads}${schemaSpreads ? ",\n" : ""}  tvp: {\n${tvpSpreads}\n  }\n};\n`;
  } else {
    const schemaExports = schemaIndexes.map(
      (schemaDir) => `export * from ${JSON.stringify(`./${schemaDir}`)};`,
    );
    const tvpImports = tvpFiles.map(
      ({ schemaDir, file }, index) =>
        `import * as tvp${index} from ${JSON.stringify(`./${schemaDir}/tvp/${stripExtension(file, language)}`)};`,
    );
    const tvpSpreads = tvpFiles
      .map((_, index) => `  ...tvp${index}`)
      .join(",\n");
    content = `${schemaExports.join("\n")}\n${tvpImports.length ? `\n${tvpImports.join("\n")}` : ""}\n\nexport const tvp = {\n${tvpSpreads}\n};\n`;
  }
  writeGenerated(path.join(outputDir, `index.${language}`), content);
}

function objectFile(outputDir, object, folder, language) {
  return path.join(
    outputDir,
    safePathSegment(object.schema),
    folder,
    `${safePathSegment(object.name)}.auto.${language}`,
  );
}

function safePathSegment(value) {
  let result = String(value).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!result) result = "_";
  if (result === "." || result === "..") result = result.replaceAll(".", "_");
  return result;
}

function validateGeneratedNameCollisions(metadata, selection) {
  const selected = {
    procedures: new Set(
      selection.procedures.map((object) =>
        objectKey(object.schema, object.name),
      ),
    ),
    tables: new Set(
      selection.tables.map((object) => objectKey(object.schema, object.name)),
    ),
    views: new Set(
      selection.views.map((object) => objectKey(object.schema, object.name)),
    ),
    tvps: new Set(
      selection.tvps.map((object) => objectKey(object.schema, object.name)),
    ),
  };

  validateSchemaFolderCollisions(metadata, selected);
  validateObjectFileCollisions(
    metadata.procedures,
    selected.procedures,
    "procedure",
    "procedures",
  );
  validateObjectFileCollisions(
    metadata.tables,
    selected.tables,
    "table",
    "tables",
  );
  validateObjectFileCollisions(metadata.views, selected.views, "view", "views");
  validateObjectFileCollisions(metadata.tvps, selected.tvps, "TVP", "tvp");
  validatePublicIdentifierCollisions(
    metadata.procedures,
    selected.procedures,
    "procedure",
  );
  validatePublicIdentifierCollisions(metadata.tvps, selected.tvps, "TVP");
}

function validateSchemaFolderCollisions(metadata, selected) {
  const allObjects = [
    ...metadata.procedures.map((object) => ["procedures", object]),
    ...metadata.tables.map((object) => ["tables", object]),
    ...metadata.views.map((object) => ["views", object]),
    ...metadata.tvps.map((object) => ["tvps", object]),
  ];
  const normalized = new Map();

  for (const [type, object] of allObjects) {
    if (!selected[type].has(objectKey(object.schema, object.name))) continue;
    const folder = safePathSegment(object.schema).toLowerCase();
    const existing = normalized.get(folder);
    if (existing && existing.toLowerCase() !== object.schema.toLowerCase()) {
      throw new Error(
        `AutoBD schema name collision after normalization: ${existing} and ${object.schema} both map to ${safePathSegment(object.schema)}`,
      );
    }
    normalized.set(folder, object.schema);
  }
}

function validateObjectFileCollisions(allObjects, selectedKeys, label, folder) {
  if (!selectedKeys.size) return;
  const byGeneratedPath = new Map();

  for (const object of allObjects) {
    const generatedPath = `${safePathSegment(object.schema).toLowerCase()}/${folder}/${safePathSegment(object.name).toLowerCase()}`;
    const existing = byGeneratedPath.get(generatedPath);
    if (
      existing &&
      objectKey(existing.schema, existing.name) !==
        objectKey(object.schema, object.name)
    ) {
      const eitherSelected =
        selectedKeys.has(objectKey(existing.schema, existing.name)) ||
        selectedKeys.has(objectKey(object.schema, object.name));
      if (eitherSelected) {
        throw new Error(
          `AutoBD ${label} file name collision after normalization: ${existing.schema}.${existing.name} and ${object.schema}.${object.name} both map to ${safePathSegment(object.name)}.auto.*`,
        );
      }
    }
    byGeneratedPath.set(generatedPath, object);
  }
}

function validatePublicIdentifierCollisions(allObjects, selectedKeys, label) {
  if (!selectedKeys.size) return;
  const byIdentifier = new Map();

  for (const object of allObjects) {
    const identifier = getObjectIdentifier(object.schema, object.name);
    const key = identifier.toLowerCase();
    const existing = byIdentifier.get(key);
    if (
      existing &&
      objectKey(existing.schema, existing.name) !==
        objectKey(object.schema, object.name)
    ) {
      const eitherSelected =
        selectedKeys.has(objectKey(existing.schema, existing.name)) ||
        selectedKeys.has(objectKey(object.schema, object.name));
      if (eitherSelected) {
        throw new Error(
          `AutoBD ${label} export collision after normalization: ${existing.schema}.${existing.name} and ${object.schema}.${object.name} both map to ${identifier}`,
        );
      }
    }
    byIdentifier.set(key, object);
  }
}

function relativeModulePath(fromDir, targetWithoutExtension) {
  let relative = path
    .relative(fromDir, targetWithoutExtension)
    .replaceAll(path.sep, "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function writeGenerated(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  assertGeneratedTarget(filePath);
  fs.writeFileSync(filePath, `${GENERATED_HEADER}\n\n${content}`, "utf8");
  generatedFiles.add(filePath);
}

function listDirectories(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listGeneratedFiles(directory, language) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter(
      (file) =>
        file.endsWith(`.auto.${language}`) &&
        isGeneratedFile(path.join(directory, file)),
    )
    .sort();
}

function stripExtension(file, language) {
  return file.slice(0, -`.${language}`.length);
}

async function formatGeneratedFiles(config) {
  if (!config.formatter.enabled) return;
  const prettier = require("prettier");
  for (const file of generatedFiles) {
    const formatted = await prettier.format(fs.readFileSync(file, "utf8"), {
      filepath: file,
    });
    fs.writeFileSync(file, formatted, "utf8");
  }
}

function printReport(config, report, failures) {
  if (!config.report && !failures.length) return;
  if (!config.report) {
    printProcedureFailures(failures);
    return;
  }
  console.log("\nAutoBD");
  console.log(`Profile: ${config.profileName ?? "default"}`);
  console.log(`Mode: ${config.mode}`);
  console.log(`Language: ${config.language}`);
  console.log(`Procedures generated: ${report.procedures.length}`);
  console.log(`Tables generated: ${report.tables.length}`);
  console.log(`Views generated: ${report.views.length}`);
  console.log(`TVPs generated: ${report.tvps.length}`);
  console.log(`TVP dependencies: ${report.dependencyTvps.length}`);
  console.log(`Procedures skipped: ${report.skippedProcedures.length}`);

  if (failures.length) {
    printProcedureFailures(failures);
    console.log("\nGeneration completed with skipped procedures.");
  } else {
    console.log("\nGeneration completed successfully.");
  }
}

function printProcedureFailures(failures) {
  console.warn(`\nAutoBD could not map ${failures.length} procedure(s):`);
  for (const failure of failures)
    console.warn(`- ${failure.procedure}: ${failure.reason}`);
}

function uniqueSchemas(metadata) {
  return [
    ...new Set(
      [
        ...metadata.procedures,
        ...metadata.tables,
        ...metadata.views,
        ...metadata.tvps,
      ].map((object) => object.schema),
    ),
  ];
}

function uniqueObjects(objects) {
  const map = new Map();
  for (const object of objects)
    map.set(objectKey(object.schema, object.name), object);
  return [...map.values()];
}

function objectKey(schema, name) {
  return `${String(schema).toLowerCase()}\u0000${String(name).toLowerCase()}`;
}

function singular(value) {
  return (
    {
      schemas: "schema",
      procedures: "procedure",
      tables: "table",
      views: "view",
      tvps: "TVP",
    }[value] ?? value
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Database reverse generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, resolveProcedureContracts };

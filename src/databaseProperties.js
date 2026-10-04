const reservedWords = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "enum",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "await",
  "null",
  "true",
  "false",
]);

function getDatabaseQueryModelSP() {
  return `
SELECT
    s.name AS SchemaName,
    p.name AS Name,
    rs.name AS ColumnName,
    TYPE_NAME(rs.system_type_id) AS SqlTypeName,
    rs.max_length AS MaxLength,
    rs.precision AS Precision,
    rs.scale AS Scale,
    rs.is_nullable AS IsNullable,
    CAST(0 AS bit) AS IsOutput,
    rs.error_number AS ErrorNumber,
    rs.error_type_desc AS ErrorTypeDesc,
    rs.error_message AS ErrorMessage,
    rs.column_ordinal AS ColumnOrdinal
FROM sys.procedures p
INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
CROSS APPLY sys.dm_exec_describe_first_result_set_for_object(p.object_id, 0) AS rs
WHERE p.is_ms_shipped = 0
  AND (rs.is_hidden = 0 OR rs.is_hidden IS NULL)
ORDER BY s.name, p.name, rs.column_ordinal;
`;
}

function getDatabaseQueryStoreProcedure() {
  return `
SELECT
    s.name AS SchemaName,
    p.name AS Name,
    prm.name AS ColumnName,
    COALESCE(base_ty.name, ty.name) AS SqlTypeName,
    prm.max_length AS MaxLength,
    prm.precision AS Precision,
    prm.scale AS Scale,
    CAST(1 AS bit) AS IsNullable,
    prm.is_output AS IsOutput,
    CAST(NULL AS int) AS ErrorNumber,
    CAST(NULL AS nvarchar(4000)) AS ErrorMessage,
    CAST(CASE WHEN table_type.user_type_id IS NULL THEN 0 ELSE 1 END AS bit) AS IsTableType,
    type_schema.name AS TypeSchemaName,
    CASE WHEN table_type.user_type_id IS NULL THEN NULL ELSE ty.name END AS TypeName,
    prm.parameter_id AS ColumnOrdinal
FROM sys.procedures p
INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
LEFT JOIN sys.parameters AS prm
    ON p.object_id = prm.object_id
    AND prm.parameter_id > 0
LEFT JOIN sys.types AS ty ON prm.user_type_id = ty.user_type_id
LEFT JOIN sys.types AS base_ty
    ON ty.system_type_id = base_ty.user_type_id
    AND base_ty.system_type_id = base_ty.user_type_id
LEFT JOIN sys.table_types AS table_type ON prm.user_type_id = table_type.user_type_id
LEFT JOIN sys.schemas AS type_schema ON table_type.schema_id = type_schema.schema_id
WHERE p.is_ms_shipped = 0
ORDER BY s.name, p.name, prm.parameter_id;
`;
}

function getDatabaseQueryProcedureContracts() {
  return `
SELECT
    s.name AS SchemaName,
    p.name AS Name,
    CONVERT(nvarchar(max), ep.value) AS ContractJson
FROM sys.procedures AS p
INNER JOIN sys.schemas AS s ON p.schema_id = s.schema_id
INNER JOIN sys.extended_properties AS ep
    ON ep.class = 1
    AND ep.major_id = p.object_id
    AND ep.minor_id = 0
    AND ep.name = N'AutoBD.ResultContract'
WHERE p.is_ms_shipped = 0;
`;
}

function getDatabaseQueryModels() {
  return `
SELECT
    s.name AS SchemaName,
    obj.name AS Name,
    CASE WHEN obj.type = 'U' THEN 'table' ELSE 'view' END AS ObjectKind,
    col.name AS ColumnName,
    COALESCE(base_ty.name, ty.name) AS SqlTypeName,
    col.max_length AS MaxLength,
    col.precision AS Precision,
    col.scale AS Scale,
    col.is_nullable AS IsNullable,
    CAST(0 AS bit) AS IsOutput,
    CAST(NULL AS int) AS ErrorNumber,
    CAST(NULL AS nvarchar(4000)) AS ErrorMessage,
    col.column_id AS ColumnOrdinal
FROM sys.columns AS col
INNER JOIN sys.objects AS obj ON col.object_id = obj.object_id
INNER JOIN sys.types AS ty ON col.user_type_id = ty.user_type_id
LEFT JOIN sys.types AS base_ty
    ON ty.system_type_id = base_ty.user_type_id
    AND base_ty.system_type_id = base_ty.user_type_id
INNER JOIN sys.schemas s ON obj.schema_id = s.schema_id
WHERE obj.type IN ('U', 'V')
  AND obj.is_ms_shipped = 0
ORDER BY s.name, obj.name, col.column_id;
`;
}

function getDatabaseQueryTvps() {
  return `
SELECT
    schema_type.name AS SchemaName,
    table_type.name AS Name,
    col.name AS ColumnName,
    COALESCE(base_ty.name, ty.name) AS SqlTypeName,
    col.max_length AS MaxLength,
    col.precision AS Precision,
    col.scale AS Scale,
    col.is_nullable AS IsNullable,
    col.column_id AS ColumnOrdinal
FROM sys.table_types AS table_type
INNER JOIN sys.schemas AS schema_type ON table_type.schema_id = schema_type.schema_id
INNER JOIN sys.columns AS col ON table_type.type_table_object_id = col.object_id
INNER JOIN sys.types AS ty ON col.user_type_id = ty.user_type_id
LEFT JOIN sys.types AS base_ty
    ON ty.system_type_id = base_ty.user_type_id
    AND base_ty.system_type_id = base_ty.user_type_id
WHERE table_type.is_user_defined = 1
ORDER BY schema_type.name, table_type.name, col.column_id;
`;
}

function getProcedureResultTypes(methodName, resultSpec, language) {
  const models = [];
  const variants = resultSpec.variants.map((variant, variantIndex) => {
    return variant.resultSets.map((resultSet, setIndex) => {
      const name =
        variantIndex === 0
          ? `${methodName}ReturnModel${setIndex ? setIndex + 1 : ""}`
          : `${methodName}Variant${variantIndex + 1}ReturnModel${setIndex ? setIndex + 1 : ""}`;
      models.push({ name, resultSet });
      return name;
    });
  });
  const firstModels = [
    ...new Set(
      variants
        .filter((variant) => variant.length)
        .map((variant) => `${variant[0]}[]`),
    ),
  ];
  const recordsetType = firstModels.length
    ? `${firstModels.join(language === "js" ? "|" : " | ")}${language === "js" ? "|" : " | "}undefined`
    : "undefined";
  const recordsetsType = resultSpec.explicit
    ? variants
        .map((variant) => `[${variant.map((name) => `${name}[]`).join(", ")}]`)
        .join(language === "js" ? "|" : " | ")
    : variants[0].length
      ? language === "js"
        ? "any[][]"
        : "unknown[][]"
      : "[]";
  return { models, recordsetType, recordsetsType };
}

function renderResultContractCheck(
  resultSpec,
  qualifiedProcedureName,
  language,
) {
  if (!resultSpec.explicit) {
    const expectedCount = resultSpec.variants[0].resultSets.length;
    return `
    if (result.recordsets.length !== ${expectedCount}) {
      throw new Error(${JSON.stringify(`AutoBD cannot map all result sets for ${qualifiedProcedureName}; add an AutoBD.ResultContract property`)});
    }`;
  }
  const expected = resultSpec.variants.map((variant) =>
    variant.resultSets.map((set) =>
      set.columns.map((column) => [column.name, column.sqlType.toLowerCase()]),
    ),
  );
  const recordsets =
    language === "ts"
      ? "(result.recordsets as unknown as Array<{ columns?: Record<string, { name: string; type?: { name?: string } }> }>)"
      : "result.recordsets";
  return `
    const expectedResultShapes = ${JSON.stringify(expected)};
    const actualResultShapes = ${recordsets}.map((set) =>
      Object.values(set.columns ?? {}).map((column) => [column.name, String(column.type?.name ?? "").toLowerCase()]),
    );
    const matchesContract = expectedResultShapes.some((variant) =>
      variant.length === actualResultShapes.length && variant.every((set, setIndex) =>
        set.length === actualResultShapes[setIndex].length && set.every((column, columnIndex) =>
          column[0] === actualResultShapes[setIndex][columnIndex][0] && column[1] === actualResultShapes[setIndex][columnIndex][1],
        ),
      ),
    );
    if (!matchesContract) {
      throw new Error(${JSON.stringify(`AutoBD result contract mismatch for ${qualifiedProcedureName}: `)} + JSON.stringify(actualResultShapes));
    }`;
}

function renderProcedureJS(
  procedure,
  resultSpec,
  dependencies,
  databaseRequirePath,
) {
  const methodName = getObjectIdentifier(procedure.schema, procedure.name);
  const outputTypeName = `${methodName}Output`;
  const resultTypeName = `${methodName}Result`;
  const qualifiedProcedureName = `${quoteSqlIdentifier(procedure.schema)}.${quoteSqlIdentifier(procedure.name)}`;

  const tvpImports = renderJsTvpImports(dependencies);
  const contractCheck = renderResultContractCheck(
    resultSpec,
    qualifiedProcedureName,
    "js",
  );
  const resultTypes = getProcedureResultTypes(methodName, resultSpec, "js");
  const returnModels = resultTypes.models
    .map(({ name, resultSet }) => renderJsReturnModel(resultSet, name))
    .join("\n\n");
  const jsDocParameters = procedure.columns
    .map((parameter) => {
      const parameterName = stripAt(parameter.name);
      const property = getJsDocProperty("parameters", parameterName);
      const type = parameter.isTableType
        ? `InstanceType<typeof ${getObjectIdentifier(parameter.typeSchema, parameter.typeName)}>`
        : getJsType(parameter);
      const nullable = parameter.isNullable ? "|null" : "";
      const expression =
        parameter.isOutput ||
        resultSpec.optionalParameters.has(parameterName.toLowerCase())
          ? `[${property}]`
          : property;
      const direction = parameter.isOutput
        ? " - Output parameter; optional initial value"
        : "";
      return ` * @param {${type}${nullable}} ${expression}${direction}`;
    })
    .join("\n");

  const outputParameters = procedure.columns.filter(
    (parameter) => parameter.isOutput,
  );
  const outputProperties = outputParameters
    .map((parameter) => {
      const name = stripAt(parameter.name);
      return ` * @property {${getJsType(parameter)}${parameter.isNullable ? "|null" : ""}} ${formatTypedefProperty(name)}`;
    })
    .join("\n");

  const bindings = procedure.columns.map(renderJsBinding).join("\n    ");
  const hasRequiredInput = procedure.columns.some(
    (parameter) =>
      !parameter.isOutput &&
      !resultSpec.optionalParameters.has(stripAt(parameter.name).toLowerCase()),
  );
  const methodParameter = hasRequiredInput ? "parameters" : "parameters = {}";
  const parameterDoc = hasRequiredInput
    ? " * @param {Object} parameters"
    : " * @param {Object} [parameters]";

  return `const sql = require("mssql");
const database = require(${JSON.stringify(databaseRequirePath)});
${tvpImports}${tvpImports ? "\n" : ""}
${returnModels}${returnModels ? "\n\n" : ""}/**
 * Output parameters returned by ${procedure.schema}.${procedure.name}.
 * @typedef {Object} ${outputTypeName}
${outputProperties}
 */

/**
 * Result returned by ${procedure.schema}.${procedure.name}.
 * @typedef {Object} ${resultTypeName}
 * @property {${resultTypes.recordsetType}} recordset
 * @property {${resultTypes.recordsetsType}} recordsets
 * @property {${outputTypeName}} output
 * @property {number} returnValue
 * @property {number[]} rowsAffected
 */

/**
 * Execute ${procedure.schema}.${procedure.name}.
${parameterDoc}
${jsDocParameters || " * No parameters are required."}
 * @returns {Promise<${resultTypeName}>}
 */
async function ${methodName}(${methodParameter}) {
  return database.using(async (pool) => {
    const request = pool.request();${bindings ? `\n    ${bindings}` : ""}
    const result = await request.execute(${JSON.stringify(qualifiedProcedureName)});${contractCheck}
    return /** @type {${resultTypeName}} */ (/** @type {unknown} */ ({
      recordset: result.recordset,
      recordsets: result.recordsets,
      output: result.output,
      returnValue: result.returnValue,
      rowsAffected: result.rowsAffected,
    }));
  });
}

module.exports = { ${methodName} };
`;
}

function renderProcedureTS(
  procedure,
  resultSpec,
  dependencies,
  databaseRequirePath,
) {
  const methodName = getObjectIdentifier(procedure.schema, procedure.name);
  const paramsTypeName = `${methodName}Params`;
  const outputTypeName = `${methodName}Output`;
  const resultTypeName = `${methodName}Result`;
  const qualifiedProcedureName = `${quoteSqlIdentifier(procedure.schema)}.${quoteSqlIdentifier(procedure.name)}`;

  const tvpImports = renderTsTvpImports(dependencies);
  const contractCheck = renderResultContractCheck(
    resultSpec,
    qualifiedProcedureName,
    "ts",
  );
  const resultTypes = getProcedureResultTypes(methodName, resultSpec, "ts");
  const returnModels = resultTypes.models
    .map(({ name, resultSet }) => renderTsReturnModel(resultSet, name))
    .join("\n\n");
  const parameterProperties = procedure.columns
    .map((parameter) => {
      const name = stripAt(parameter.name);
      const optional =
        parameter.isOutput ||
        resultSpec.optionalParameters.has(name.toLowerCase())
          ? "?"
          : "";
      const type = parameter.isTableType
        ? getObjectIdentifier(parameter.typeSchema, parameter.typeName)
        : getTsType(parameter);
      return `  ${formatTsProperty(name)}${optional}: ${type}${parameter.isNullable ? " | null" : ""};`;
    })
    .join("\n");

  const outputProperties = procedure.columns
    .filter((parameter) => parameter.isOutput)
    .map((parameter) => {
      const name = stripAt(parameter.name);
      return `  ${formatTsProperty(name)}: ${getTsType(parameter)}${parameter.isNullable ? " | null" : ""};`;
    })
    .join("\n");

  const bindings = procedure.columns.map(renderTsBinding).join("\n    ");
  const hasRequiredInput = procedure.columns.some(
    (parameter) =>
      !parameter.isOutput &&
      !resultSpec.optionalParameters.has(stripAt(parameter.name).toLowerCase()),
  );
  const methodParameter = hasRequiredInput
    ? `parameters: ${paramsTypeName}`
    : `parameters: ${paramsTypeName} = {}`;

  return `import sql = require("mssql");
import database = require(${JSON.stringify(databaseRequirePath)});
${tvpImports}${tvpImports ? "\n" : ""}
${returnModels}${returnModels ? "\n\n" : ""}export interface ${paramsTypeName} {
${parameterProperties}
}

export interface ${outputTypeName} {
${outputProperties}
}

export interface ${resultTypeName} {
  recordset: ${resultTypes.recordsetType};
  recordsets: ${resultTypes.recordsetsType};
  output: ${outputTypeName};
  returnValue: number;
  rowsAffected: number[];
}

export async function ${methodName}(${methodParameter}): Promise<${resultTypeName}> {
  return database.using(async (pool) => {
    const request = pool.request();${bindings ? `\n    ${bindings}` : ""}
    const result = await request.execute(${JSON.stringify(qualifiedProcedureName)});${contractCheck}
    return {
      recordset: result.recordset as unknown as ${resultTypes.recordsetType},
      recordsets: result.recordsets as unknown as ${resultTypes.recordsetsType},
      output: result.output as unknown as ${outputTypeName},
      returnValue: result.returnValue,
      rowsAffected: result.rowsAffected,
    };
  });
}
`;
}

function renderModelJS(model) {
  const className = getObjectIdentifier(model.schema, model.name);
  const fields = model.columns
    .map(
      (column) =>
        `    this[${JSON.stringify(column.name)}] = conditions[${JSON.stringify(column.name)}];`,
    )
    .join("\n");
  const docs = model.columns
    .map(
      (column) =>
        ` * @param {${getJsType(column)}${column.isNullable ? "|null" : ""}} [conditions${formatPropertyAccess(column.name)}]`,
    )
    .join("\n");
  return `/** Represents ${model.schema}.${model.name}. */
class ${className} {
  /**
   * @param {Object} [conditions]
${docs}
   */
  constructor(conditions = {}) {
${fields}
  }
}

module.exports = { ${className} };
`;
}

function renderModelTS(model) {
  const className = getObjectIdentifier(model.schema, model.name);
  const fields = model.columns
    .map(
      (column) =>
        `  ${formatTsClassProperty(column.name)}!: ${getTsType(column)}${column.isNullable ? " | null" : ""};`,
    )
    .join("\n");
  const assignments = model.columns
    .map(
      (column) =>
        `    if (${JSON.stringify(column.name)} in conditions) this[${JSON.stringify(column.name)}] = conditions[${JSON.stringify(column.name)}] as this[${JSON.stringify(column.name)}];`,
    )
    .join("\n");
  return `/** Represents ${model.schema}.${model.name}. */
export class ${className} {
${fields}

  constructor(conditions: Partial<${className}> = {}) {
${assignments}
  }
}
`;
}

function renderTvpJS(tvp) {
  const className = getObjectIdentifier(tvp.schema, tvp.name);
  const rowName = `${className}Row`;
  const qualifiedName = `${tvp.schema}.${tvp.name}`;
  const columns = tvp.columns
    .map(
      (column) =>
        `    this.columns.add(${JSON.stringify(column.name)}, ${getMssqlTypeExpression(column)}, { nullable: ${column.isNullable} });`,
    )
    .join("\n");
  const values = tvp.columns
    .map((column) => `row[${JSON.stringify(column.name)}]`)
    .join(", ");
  const docs = tvp.columns
    .map((column) => {
      const name = column.name;
      const property = formatTypedefProperty(name);
      return ` * @property {${getJsType(column)}${column.isNullable ? "|null" : ""}} ${column.isNullable ? `[${property}]` : property}`;
    })
    .join("\n");
  return `const sql = require("mssql");

/**
 * @typedef {Object} ${rowName}
${docs}
 */

class ${className} extends sql.Table {
  /** @param {${rowName}[]} [rows] */
  constructor(rows = []) {
    super(${JSON.stringify(qualifiedName)});
${columns}
    for (const row of rows) this.add(row);
  }

  /**
   * @param {${rowName}} row
   * @returns {${className}}
   */
  add(row) {
    this.rows.add(${values});
    return this;
  }
}

module.exports = { ${className} };
`;
}

function renderTvpTS(tvp) {
  const className = getObjectIdentifier(tvp.schema, tvp.name);
  const rowName = `${className}Row`;
  const qualifiedName = `${tvp.schema}.${tvp.name}`;
  const rowProperties = tvp.columns
    .map(
      (column) =>
        `  ${formatTsProperty(column.name)}${column.isNullable ? "?" : ""}: ${getTsType(column)}${column.isNullable ? " | null" : ""};`,
    )
    .join("\n");
  const columns = tvp.columns
    .map(
      (column) =>
        `    this.columns.add(${JSON.stringify(column.name)}, ${getMssqlTypeExpression(column)}, { nullable: ${column.isNullable} });`,
    )
    .join("\n");
  const values = tvp.columns
    .map((column) => `row[${JSON.stringify(column.name)}]`)
    .join(", ");
  return `import sql = require("mssql");

export interface ${rowName} {
${rowProperties}
}

export class ${className} extends sql.Table {
  constructor(rows: ${rowName}[] = []) {
    super(${JSON.stringify(qualifiedName)});
${columns}
    for (const row of rows) this.add(row);
  }

  add(row: ${rowName}): this {
    this.rows.add(${values});
    return this;
  }
}
`;
}

function renderJsReturnModel(model, className) {
  const fields = model.columns
    .map(
      (column) =>
        `    this[${JSON.stringify(column.name)}] = conditions[${JSON.stringify(column.name)}];`,
    )
    .join("\n");
  const docs = model.columns
    .map(
      (column) =>
        ` * @param {${getJsType(column)}${column.isNullable ? "|null" : ""}} [conditions${formatPropertyAccess(column.name)}]`,
    )
    .join("\n");
  return `class ${className} {
  /**
   * @param {Object} [conditions]
${docs}
   */
  constructor(conditions = {}) {
${fields}
  }
}`;
}

function renderTsReturnModel(model, className) {
  const fields = model.columns
    .map(
      (column) =>
        `  ${formatTsClassProperty(column.name)}!: ${getTsType(column)}${column.isNullable ? " | null" : ""};`,
    )
    .join("\n");
  const assignments = model.columns
    .map(
      (column) =>
        `    if (${JSON.stringify(column.name)} in conditions) this[${JSON.stringify(column.name)}] = conditions[${JSON.stringify(column.name)}] as this[${JSON.stringify(column.name)}];`,
    )
    .join("\n");
  return `export class ${className} {
${fields}

  constructor(conditions: Partial<${className}> = {}) {
${assignments}
  }
}`;
}

function renderJsTvpImports(dependencies) {
  return dependencies
    .map((dependency) => {
      const className = getObjectIdentifier(
        dependency.tvp.schema,
        dependency.tvp.name,
      );
      return `const { ${className} } = require(${JSON.stringify(dependency.requirePath)});`;
    })
    .join("\n");
}

function renderTsTvpImports(dependencies) {
  return dependencies
    .map((dependency) => {
      const className = getObjectIdentifier(
        dependency.tvp.schema,
        dependency.tvp.name,
      );
      return `import { ${className} } from ${JSON.stringify(dependency.requirePath)};`;
    })
    .join("\n");
}

function renderJsBinding(parameter) {
  const name = stripAt(parameter.name);
  const value = `parameters[${JSON.stringify(name)}]`;
  if (parameter.isTableType)
    return `if (${value} !== undefined) request.input(${JSON.stringify(name)}, ${value});`;
  const sqlType = getMssqlTypeExpression(parameter);
  if (parameter.isOutput)
    return `request.output(${JSON.stringify(name)}, ${sqlType}, ${value});`;
  return `if (${value} !== undefined) request.input(${JSON.stringify(name)}, ${sqlType}, ${value});`;
}

function renderTsBinding(parameter) {
  return renderJsBinding(parameter);
}

function getJsType(column) {
  const type = String(column.sqlType ?? "").toLowerCase();
  if (type === "bit") return "boolean";
  if (type === "bigint") return "string";
  if (
    [
      "tinyint",
      "smallint",
      "int",
      "decimal",
      "numeric",
      "float",
      "real",
      "money",
      "smallmoney",
    ].includes(type)
  )
    return "number";
  if (
    [
      "date",
      "datetime",
      "datetime2",
      "smalldatetime",
      "datetimeoffset",
      "time",
    ].includes(type)
  )
    return "Date";
  if (
    ["binary", "varbinary", "image", "timestamp", "rowversion"].includes(type)
  )
    return "Buffer";
  if (
    [
      "char",
      "varchar",
      "text",
      "nchar",
      "nvarchar",
      "ntext",
      "uniqueidentifier",
      "xml",
    ].includes(type)
  )
    return "string";
  throw new Error(
    `Unsupported SQL Server type for JS mapping: ${column.sqlType}`,
  );
}

function getTsType(column) {
  const type = String(column.sqlType ?? "").toLowerCase();
  if (type === "bit") return "boolean";
  if (type === "bigint") return "string";
  if (
    [
      "tinyint",
      "smallint",
      "int",
      "decimal",
      "numeric",
      "float",
      "real",
      "money",
      "smallmoney",
    ].includes(type)
  )
    return "number";
  if (
    [
      "date",
      "datetime",
      "datetime2",
      "smalldatetime",
      "datetimeoffset",
      "time",
    ].includes(type)
  )
    return "Date";
  if (
    ["binary", "varbinary", "image", "timestamp", "rowversion"].includes(type)
  )
    return "Buffer";
  if (
    [
      "char",
      "varchar",
      "text",
      "nchar",
      "nvarchar",
      "ntext",
      "uniqueidentifier",
      "xml",
    ].includes(type)
  )
    return "string";
  throw new Error(
    `Unsupported SQL Server type for TypeScript mapping: ${column.sqlType}`,
  );
}

function getMssqlTypeExpression(column) {
  const type = String(column.sqlType ?? "").toLowerCase();
  const precision = Number(column.precision) || 18;
  const scale = Number(column.scale) || 0;
  const direct = {
    bit: "sql.Bit",
    tinyint: "sql.TinyInt",
    smallint: "sql.SmallInt",
    int: "sql.Int",
    bigint: "sql.BigInt",
    float: "sql.Float",
    real: "sql.Real",
    money: "sql.Money",
    smallmoney: "sql.SmallMoney",
    date: "sql.Date",
    datetime: "sql.DateTime",
    smalldatetime: "sql.SmallDateTime",
    uniqueidentifier: "sql.UniqueIdentifier",
    text: "sql.Text",
    ntext: "sql.NText",
    image: "sql.Image",
    xml: "sql.Xml",
  };
  if (direct[type]) return direct[type];
  if (type === "decimal" || type === "numeric")
    return `sql.Decimal(${precision}, ${scale})`;
  if (type === "datetime2") return `sql.DateTime2(${scale})`;
  if (type === "datetimeoffset") return `sql.DateTimeOffset(${scale})`;
  if (type === "time") return `sql.Time(${scale})`;
  const length = getTypeLength(column);
  if (type === "varchar") return `sql.VarChar(${length})`;
  if (type === "char") return `sql.Char(${length})`;
  if (type === "nvarchar") return `sql.NVarChar(${length})`;
  if (type === "nchar") return `sql.NChar(${length})`;
  if (["varbinary", "timestamp", "rowversion"].includes(type))
    return `sql.VarBinary(${length})`;
  if (type === "binary") return `sql.Binary(${length})`;
  throw new Error(
    `Unsupported SQL Server type for mssql binding: ${column.sqlType}`,
  );
}

function getTypeLength(column) {
  if (column.maxLength === -1) return "sql.MAX";
  const type = String(column.sqlType ?? "").toLowerCase();
  const maxLength = Number(column.maxLength);
  if (!Number.isInteger(maxLength) || maxLength <= 0) {
    throw new Error(
      `Invalid max length for ${column.sqlType}: ${column.maxLength}`,
    );
  }
  return type === "nvarchar" || type === "nchar"
    ? Math.max(1, Math.floor(maxLength / 2))
    : maxLength;
}

function getObjectIdentifier(schema, name) {
  return toJsIdentifier(`${schema}_${name}`);
}

function toJsIdentifier(value) {
  let result = String(value).replace(/[^A-Za-z0-9_$]/g, "_");
  if (!/^[A-Za-z_$]/.test(result)) result = `_${result}`;
  if (reservedWords.has(result)) result = `_${result}`;
  return result;
}

function quoteSqlIdentifier(value) {
  return `[${String(value).replaceAll("]", "]]")}]`;
}

function stripAt(value) {
  return String(value ?? "").replace(/^@/, "");
}

function formatTsProperty(property) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)
    ? property
    : JSON.stringify(property);
}

function formatTsClassProperty(property) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)
    ? property
    : `[${JSON.stringify(property)}]`;
}

function formatPropertyAccess(property) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)
    ? `.${property}`
    : `[${JSON.stringify(property)}]`;
}

function getJsDocProperty(root, property) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)
    ? `${root}.${property}`
    : `${root}[${JSON.stringify(property)}]`;
}

function formatTypedefProperty(property) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)
    ? property
    : `[${JSON.stringify(property)}]`;
}

module.exports = {
  database_query_models: getDatabaseQueryModels(),
  database_query_model_sp: getDatabaseQueryModelSP(),
  database_query_store_procedure: getDatabaseQueryStoreProcedure(),
  database_query_procedure_contracts: getDatabaseQueryProcedureContracts(),
  database_query_tvps: getDatabaseQueryTvps(),
  renderProcedureJS,
  renderProcedureTS,
  renderModelJS,
  renderModelTS,
  renderTvpJS,
  renderTvpTS,
  getObjectIdentifier,
  getJsType,
};

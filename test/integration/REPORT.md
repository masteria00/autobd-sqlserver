# AutoBD: prueba de tipos comunes contra SQL Server real

Fecha: 2026-10-03. Base aislada `tests`, esquema `autobd_types`; Node.js 22.12.0, `mssql` 11. AutoBD generó 19 procedimientos y un TVP en JS y TS. Se probó la cadena SQL Server → metadata → generación → compilación → ejecución → comparación de valores. Los archivos bajo `consumer/generated/` fueron creados por AutoBD, sin edición manual.

**Criterio:** PASS exige compilación y resultado correcto; PARTIAL indica que solo parte del rango/contrato funciona. No hubo tipos explícitamente UNSUPPORTED en esta selección. Cada SP de tipo tiene `Value` requerido para omisión, `Optional = NULL`, `Output OUTPUT`, un SELECT de valor/opcional/NULL; se ejecutó con valor normal, `Value = NULL`, `Optional = NULL`, y `Optional` omitido. En SQL Server, “requerido” aquí significa que el argumento no se puede omitir: no implica prohibir SQL NULL.

## Matriz por tipo

En la columna de compilación, `JS/TS ✓` significa `tsc --checkJs --strict` sobre los JS generados y `tsc --strict` sobre los TS generados. En ejecución se verificaron SELECT, OUTPUT, NULL y parámetro opcional salvo la limitación indicada. Las rutas se refieren al paquete.

| Tipo | Caso probado | Wrapper esperado | Wrapper generado | Compilación | Ejecución real | Estado | Problema | Archivo/función | Cambio mínimo recomendado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INT | 42, NULL, DEFAULT y OUTPUT | `number\|null`, `sql.Int` | Coincide | JS/TS ✓ | 42/NULL/DEFAULT correctos | PASS | Ninguno | `src/databaseProperties.js:getJsType` | Ninguno |
| BIGINT | 42, MAX_SAFE_INTEGER y 9007199254740993 | `string\|null`, `sql.BigInt` | Coincide | JS/TS ✓ | Strings exactos en SELECT y OUTPUT | PASS | Ninguno; no convierte a number | `getJsType`, `renderJsBinding` | Conservar string |
| BIT | true, false, NULL | `boolean\|null`, `sql.Bit` | Coincide | JS/TS ✓ | Booleanos y NULL correctos | PASS | Ninguno | `getJsType` | Ninguno |
| DECIMAL(18,2) | 12.34 y 1234567890123456.78 | Numérico sin pérdida en todo el rango | `number\|null`, `sql.Decimal(18, 2)` | JS/TS ✓ | 12.34 correcto; el valor grande llega a SQL como `1234567890123456.80` y sale como `1234567890123456.8` | PARTIAL | Pérdida silenciosa de centavos | `renderJsBinding`; Tedious `data-types/decimal.js` | Contrato de entrada/salida decimal como texto exacto con conversión SQL; para SELECT exacto, SP debe devolver texto. Versionar el cambio de contrato. |
| DECIMAL(38,18) | 1 y 12345678901234567890.123456789012345678 | Numérico sin pérdida en todo el rango | `number\|null`, `sql.Decimal(38, 18)` | JS/TS ✓ | 1 correcto; valor grande rechazado: `Input parameter 'Value' could not be validated` | PARTIAL | El driver no representa 38 dígitos con `number` | `renderJsBinding`; Tedious `data-types/decimal.js` | Mismo cambio de contrato decimal; evitar prometer exactitud con `number` |
| FLOAT | 12345.678901234, NULL | `number\|null`, `sql.Float` | Coincide | JS/TS ✓ | Valor y OUTPUT correctos para el ejemplo | PASS | Precisión binaria habitual de FLOAT | `getJsType` | Ninguno |
| VARCHAR(100) | Acentos, ñ, vacío, NULL | `string\|null`, `sql.VarChar(100)` | Coincide | JS/TS ✓ | Coincide en esta intercalación/base | PASS | Ninguno en los caracteres probados | `getMssqlTypeExpression` | Ninguno |
| VARCHAR(MAX) | 10,000 caracteres, NULL | `string\|null`, `sql.VarChar(sql.MAX)` | Coincide | JS/TS ✓ | Cadena completa y NULL | PASS | Ninguno | `getMssqlTypeExpression` | Ninguno |
| NVARCHAR(100) | Acentos, ñ, emoji, 東京, vacío, NULL | `string\|null`, `sql.NVarChar(100)` | Coincide | JS/TS ✓ | Unicode completo y NULL | PASS | Ninguno | `getMssqlTypeExpression` | Ninguno |
| NVARCHAR(MAX) | 2,000 emoji, NULL | `string\|null`, `sql.NVarChar(sql.MAX)` | Coincide | JS/TS ✓ | Cadena completa y NULL | PASS | Ninguno | `getMssqlTypeExpression` | Ninguno |
| DATE | Fecha UTC y NULL | `Date\|null`, `sql.Date` | Coincide | JS/TS ✓ | Día correcto y NULL | PASS | Ninguno en el ejemplo | `getJsType` | Ninguno |
| DATETIME | Instante con 123 ms y NULL | `Date\|null`, `sql.DateTime` | Coincide | JS/TS ✓ | Instante y OUTPUT correctos | PASS | La precisión propia de SQL DATETIME no se ensayó fuera de este valor | `getJsType` | Ninguno para el caso probado |
| DATETIME2(7) | Fecha con 123 ms; literal SQL con `.1234567` | `Date` si bastan ms; 7 dígitos si se exige exactitud SQL | `Date\|null`, `sql.DateTime2(7)` | JS/TS ✓ | 123 ms correctos; `.1234567` se lee como `.123` | PARTIAL | Pérdida de 4 dígitos fraccionarios | `getJsType`; driver `datetime2` | Exponer texto ISO desde el SP para precisión > ms o introducir representación exacta versionada |
| UNIQUEIDENTIFIER | GUID válido y NULL | `string\|null`, `sql.UniqueIdentifier` | Coincide | JS/TS ✓ | GUID semánticamente igual; driver lo devuelve en mayúsculas | PASS | Cambia solo el caso de las letras | `getJsType` | Ninguno |
| VARBINARY(MAX) | Bytes `00 01 02 7f 80 ff`, NULL | `Buffer\|null`, `sql.VarBinary(sql.MAX)` | Coincide | JS/TS ✓ | Buffer byte a byte correcto | PASS | Ninguno | `getJsType` | Ninguno |

## TVP, cambios de contrato y compilación negativa

| Tipo | Caso probado | Wrapper esperado | Wrapper generado | Compilación | Ejecución real | Estado | Problema | Archivo/función | Cambio mínimo recomendado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TVP `DetalleType` | 1, 2, 0 y 1,000 filas; NULL en Nombre | Clase `sql.Table`, columnas/tipos y nulabilidad correctos | Coincide | JS/TS ✓ | Conteos y valores correctos | PASS | Ninguno en el rango probado | `renderTvpJS`, `renderTvpTS` | Ninguno |
| TVP `DetalleType` | Id inválido y Cantidad NULL | Rechazo | Coincide | TS rechaza fila mal formada | Driver/SQL rechazan | PASS | El error para Cantidad NULL llega sin mensaje útil | `renderTvpJS`, driver TVP | Mejorar mensaje de error si se decide exponer validación previa |
| Contrato incremental | INT→BIGINT; VARCHAR→NVARCHAR; DECIMAL(18,2)→DECIMAL(38,18); DATETIME→DATETIME2 | Cambiar binding y tipos JS/TS | Coincide en 8 etapas | TS final ✓ | Cada wrapper regenerado ejecutó | PASS | La precisión decimal/temporal sigue limitada | `src/generator.js:main`, plantillas | Ninguno para regeneración |
| Contrato de omisión | requerido→opcional→requerido vía `AutoBD.ResultContract` | Cambiar `Value`/`Value?` | Coincide | TS ✓ | DEFAULT omitido y requerido presentes | PASS | SQL NULL sigue aceptado por estos SPs | `resolveProcedureContracts`, `renderProcedureTS` | Ninguno |
| SELECT | Agregar columna `Activo` | Agregar tipo al modelo | Coincide | TS ✓ | SELECT devuelve `Activo: true` | PASS | Ninguno | `renderTsReturnModel` | Ninguno |
| TypeScript negativo | tipo equivocado, requerido ausente, extra, `undefined`, OUTPUT erróneo, TVP incompleto/NULL/tipo erróneo/filas crudas | Cada ejemplo debe fallar | Coincide | `@ts-expect-error` verificado con `--strict` | No se ejecutan casos inválidos | PASS | Los escalares aceptan NULL porque el SP también lo acepta | `consumer/typecheck.ts` | Ninguno |
| JS + JSDoc | `checkJs` estricto, requeridos y TVP inválido | Compilar y detectar errores de uso | Inicialmente falló; corregido en la plantilla | Ahora ✓ | Regresión JS ✓ | PASS | Inicial: `{}` por defecto para requerido, tipo TVP mal referido y `recordsets` incompatible | `renderProcedureJS`, `renderTvpJS` | Corrección aplicada y regenerada |
| TS compilado | INT, BIGINT inseguro para `number`, TVP | Compilar y ejecutar JS emitido desde TS | Coincide | ✓ | Valores correctos contra SQL Server | PASS | Ninguno en estos casos | `consumer/runCompiledTs.js` | Ninguno |

## Causa y alcance de las limitaciones

Tedious valida DECIMAL con `parseFloat` y serializa usando aritmética de `Number`. Por eso no basta con que AutoBD conozca precisión y escala: el binding actual pierde información. La prueba directa demostró que enviar y recibir esos parámetros como `NVARCHAR` conserva el texto exacto en SQL y en OUTPUT, mientras un SELECT DECIMAL sigue llegando como `number` impreciso. Cambiarlo en AutoBD exige definir y versionar contratos distintos para entrada, OUTPUT, columnas SELECT y TVP. No se hizo ese cambio incompatible durante esta prueba. `DATETIME2(7)` se decodifica como `Date`, cuya interfaz conserva milisegundos.

La corrección aplicada fue acotada a JSDoc: parámetros requeridos ya no reciben `{}` por defecto, el TVP tiene un tipo de fila real, y el resultado JS se anota explícitamente. Se regeneró desde las plantillas y se repitieron compilación, ejecución y 24 pruebas existentes de AutoBD en la API, además de 4 pruebas del paquete. Los casos DECIMAL y DATETIME2 de precisión alta permanecen **PARTIAL** y están advertidos en el README.

## Reproducir

Con una base aislada llamada `tests`, variables `DB_USER`, `DB_PASSWORD`, `DB_SERVER`, `DB_DATABASE`, `DB_PORT`, y dependencias instaladas en el paquete:

```text
node test/integration/setupTypeMatrix.js
cd test/integration/consumer
node ../../../bin/autobd.js generate --config config.autobd.json --profile types
node runMatrix.js
node probeTVP.js
node runCompiledTs.js
```

Desde la raíz del paquete, ejecutar `node test/integration/contractMutation.js` para los cambios de contrato y `tsc --strict` sobre `consumer/typecheck.ts`. `prepareJsOnly.js` copia los archivos generados JS a un directorio sin sus pares TS; `tsc --allowJs --checkJs --strict` sobre `js-only/jsdoc-check.js` verifica JSDoc real. En Windows, `test/integration/runAll.ps1` ejecuta toda la secuencia, incluida la compilación TS previa a `runCompiledTs.js`; exige que las variables `DB_*` ya estén definidas.

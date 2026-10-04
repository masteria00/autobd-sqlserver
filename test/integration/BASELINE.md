# Baseline de pruebas E2E (antes de corregir)

Base aislada `tests`, esquema `autobd_types`; AutoBD generó 18 procedimientos y 1 TVP en JS y TS. El TypeScript generado compila con `tsc --strict`.

| Caso | Observación real | Causa | Corrección mínima propuesta |
| --- | --- | --- | --- |
| BIGINT > `Number.MAX_SAFE_INTEGER` | `"9007199254740993"` vuelve intacto en SELECT y OUTPUT. | El driver y AutoBD usan `string`. | Ninguna. |
| DECIMAL(18,2) de 18 dígitos | `"1234567890123456.78"` llega como `1234567890123456.8`; SQL confirma `1234567890123456.80`. | El tipo DECIMAL de Tedious valida y serializa mediante `Number`/`parseFloat`; el wrapper lo anuncia como `number`. | Detectar y rechazar valores no representables con exactitud antes de llamar al driver; documentar el límite de SELECT/OUTPUT. |
| DECIMAL(38,18) de alta precisión | `"12345678901234567890.123456789012345678"` falla con `Input parameter 'Value' could not be validated`. | La serialización decimal del driver usa `Number`, insuficiente para 38 dígitos. | Reportar el límite explícitamente en el contrato generado; no prometer precisión exacta. |
| DATETIME2(7) con siete decimales | SQL devuelve `.1234567`, JavaScript `Date` conserva `.123`. | `Date` y el driver exponen milisegundos. | Reportar que solo se preservan milisegundos; considerar representación de texto para precisión completa en una extensión futura. |
| TVP con 1, 2 y 1000 filas, vacío y NULL permitido | SELECT correcto; tipos erróneos se rechazan. | Generador y driver funcionan en estos casos. | Ninguna. |
| JSDoc con `checkJs` | El JS generado no compila: el valor por defecto `{}` contradice los parámetros requeridos; TVP importado se usa como tipo sin declaración; constructor del TVP queda `any`. La llamada sin argumentos y la fila TVP mal formada no se detectan. | Plantillas `renderProcedureJS` y `renderTvpJS` en `src/databaseProperties.js`. | Quitar `{}` cuando hay parámetros requeridos y dar JSDoc de tipo al constructor y parámetro TVP. |

Estos son resultados iniciales, no un veredicto final. Faltan pruebas de compilación negativa, cambios de contrato y regresión automatizada. No se ha modificado el mapeo de tipos.

import {
  autobd_types_TestInt,
  autobd_types_TestBigInt,
  autobd_types_TestVarBinaryMax,
  autobd_types_TestTVP,
  tvp,
} from "./generated";

async function valid() {
  const integer = await autobd_types_TestInt({ Value: 10, Optional: null });
  const output: number | null = integer.output.Output;
  const big: string | null =
    (await autobd_types_TestBigInt({ Value: "9007199254740993" }))
      .recordset?.[0].Value ?? null;
  const binary: Buffer | null =
    (await autobd_types_TestVarBinaryMax({ Value: Buffer.from([0, 255]) }))
      .recordset?.[0].Value ?? null;
  const table = new tvp.autobd_types_DetalleType([
    { Id: 1, Nombre: null, Cantidad: 1.25, Activo: true },
  ]);
  await autobd_types_TestTVP({ Detalles: table });
  return { output, big, binary };
}

async function invalid() {
  // @ts-expect-error string no es INT
  await autobd_types_TestInt({ Value: "10" });
  // @ts-expect-error falta el parámetro requerido
  await autobd_types_TestInt({});
  // @ts-expect-error parámetro inexistente
  await autobd_types_TestInt({ Value: 10, Extra: 1 });
  // @ts-expect-error undefined no es un valor válido para el requerido
  await autobd_types_TestInt({ Value: undefined });
  // @ts-expect-error string no es OUTPUT INT
  await autobd_types_TestInt({ Value: 10, Output: "bad" });
  // @ts-expect-error faltan campos requeridos del TVP
  new tvp.autobd_types_DetalleType([{ Id: 1 }]);
  // @ts-expect-error Id del TVP es NOT NULL
  new tvp.autobd_types_DetalleType([{ Id: null, Nombre: null, Cantidad: 1, Activo: true }]);
  new tvp.autobd_types_DetalleType([
    // @ts-expect-error Nombre no admite number
    { Id: 1, Nombre: 2, Cantidad: 1, Activo: true },
  ]);
  await autobd_types_TestTVP({
    // @ts-expect-error se requiere la instancia de TVP, no filas crudas
    Detalles: [{ Id: 1, Nombre: null, Cantidad: 1, Activo: true }],
  });
}

void valid;
void invalid;

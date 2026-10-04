// @ts-check
const { autobd_types_TestInt, tvp } = require("./generated");

void autobd_types_TestInt({ Value: 10 });
void new tvp.autobd_types_DetalleType([
  { Id: 1, Nombre: null, Cantidad: 1.25, Activo: true },
]);

// @ts-expect-error string no es INT
void autobd_types_TestInt({ Value: "10" });
// @ts-expect-error falta el valor requerido
void autobd_types_TestInt({});
// @ts-expect-error falta el objeto de parámetros requeridos
void autobd_types_TestInt();
void new tvp.autobd_types_DetalleType([
  // @ts-expect-error TVP inválido
  { Id: "wrong", Nombre: null, Cantidad: 1, Activo: true },
]);

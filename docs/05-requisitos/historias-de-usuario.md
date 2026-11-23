# 5.2 Historias de usuario (Given / When / Then)

## HU-01 · Armar una consulta agregada
**Como** analista de inventario **quiero** armar una consulta con filtros, agrupación y orden desde la pantalla **para** obtener el stock por almacén sin escribir SQL.

```gherkin
Scenario: Stock por almacén
  Given que estoy autenticado como admin y elijo la tabla base "stock" con JOIN a "almacenes"
  When selecciono almacenes.nombre y SUM(stock.cantidad), ordeno por la suma descendente y presiono "Ejecutar"
  Then veo el SQL con GROUP BY, ORDER BY y LIMIT ?
  And veo una tabla con los 5 almacenes ordenados
  And puedo graficar el resultado en barras
```
Reglas: RN-03, RN-04 · Pruebas: `compila SELECT + JOIN + WHERE anidado…`, `ejecuta y devuelve filas ordenadas`.

## HU-02 · Rechazar consultas maliciosas
**Como** responsable de seguridad **quiero** que el sistema rechace inyecciones y accesos a tablas no autorizadas **para** proteger los datos.

```gherkin
Scenario: Inyección y tabla no autorizada
  Given que estoy autenticado con cualquier rol
  When envío una consulta con el valor  ' OR 1=1 --  o con la tabla base "usuarios"
  Then el sistema responde 400 INJECTION_SUSPECT o 403 TABLE_NOT_ALLOWED
  And no ejecuta ninguna sentencia
  And el intento aparece en la auditoría del admin
```
Reglas: RN-01, RN-02, RN-07 · Pruebas: `rechaza patrones de inyección…`, `API: tabla no autorizada => 403; inyección => 400…`.

## HU-03 · Ver solo mi almacén (RLS)
**Como** operario del almacén de Lima **quiero** ver solo la información de mi almacén **para** no exponer datos de otras sedes.

```gherkin
Scenario: Operario con filtro obligatorio
  Given que estoy autenticado como operario1 (almacén 1)
  When ejecuto el stock agrupado por almacén, incluso agregando la condición OR almacen_id = 2
  Then obtengo una sola fila: Almacén Lima Centro
  And el SQL muestra el filtro obligatorio "stock"."almacen_id" = ?
  And no puedo seleccionar costo_unitario
```
Reglas: RN-05, RN-06 · Pruebas: `RLS: admin ve 5 almacenes; operario ve solo el suyo`, `RLS no se puede evadir con OR…`, `column-level…`.

## Trazabilidad
| Historia | Regla | Prueba (nombre en `tests/`) |
|---|---|---|
| HU-01 | RN-03, RN-04 | compila SELECT + JOIN + WHERE anidado…; ejecuta y devuelve filas ordenadas |
| HU-02 | RN-01, RN-02 | rechaza patrones de inyección; rechaza tablas y columnas fuera de la whitelist |
| HU-02 | RN-07 | API: tabla no autorizada => 403; inyección => 400 |
| HU-03 | RN-05 | RLS: admin ve 5 almacenes…; RLS no se puede evadir con OR |
| HU-03 | RN-06 | column-level: operario/consulta no pueden leer costo_unitario |
| (operación) | RN-08 | API: movimientos del operario quedan forzados a su almacén |

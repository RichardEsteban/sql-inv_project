# 6. Guion de demo y casos borde para la defensa

**Preparación:** `npm install` · `npm start` · abrir http://localhost:3000 (≈ 12 min). Usuarios: `admin/admin123`, `operario1/oper123`, `consulta/cons123`.

## Guion
| N.º | Acción | Resultado esperado |
|---|---|---|
| 1 | Ingresar como `admin`. | Pestañas visibles, incluida Auditoría. |
| 2 | Constructor: base `stock` + JOIN `almacenes`; SELECT `almacenes.nombre` y `SUM(stock.cantidad)`; ordenar; ejecutar. | SQL con GROUP BY, ORDER BY, `LIMIT ?`; 5 filas. |
| 3 | Graficar en barras y en torta. | El gráfico coincide con la tabla. |
| 4 | Agregar JOIN `categorias`/`productos`; WHERE raíz AND con `cantidad > 10` y subgrupo OR de dos categorías. | SQL con paréntesis anidados; valores solo en "Parámetros". |
| 5 | Agregar HAVING `SUM(cantidad) ≥ 100`. | Aparece `HAVING … ?`. |
| 6 | Pestaña Seguridad: lanzar los 8 ataques. | Cada uno devuelve su código y no ejecuta nada. |
| 7 | Pestaña Auditoría. | Rechazos con `ok = 0`. |
| 8 | Dashboard. | 3 KPIs, 2 gráficas; SQL desplegable. |
| 9 | Entrar como `operario1`; repetir el paso 2. | 1 fila (Lima Centro) y filtro de política visible. |
| 10 | Como operario: "evadir RLS" y `costo_unitario`. | 0 filas / 403 `COLUMN_NOT_ALLOWED`. |
| 11 | Como operario: ENTRADA de 5 unidades. | Stock actualizado y auditado. |
| 12 | Entrar como `consulta`; intentar registrar movimiento. | 403 `FORBIDDEN`. |
| 13 | Terminal: `npm run demo:abstraccion`. | 45 líneas vs 10; resultados idénticos. |
| 14 | Terminal: `npm run demo:motor` y `npm test`. | SQL SQLite vs PostgreSQL; 21 pruebas en verde. |

## Casos borde (por si preguntan)
| Caso | Entrada | Respuesta |
|---|---|---|
| Inyección en valor | `' OR 1=1 --` | 400 `INJECTION_SUSPECT` |
| Valor con comilla legítima | `O'Brien` | Se ejecuta; viaja como parámetro, no entra al SQL |
| Alias malicioso | `x; DROP TABLE productos` | 400 `BAD_ALIAS` |
| Nombre de tabla con DROP | `productos; DROP TABLE productos` | 400 `BAD_TABLE` |
| Tabla de seguridad | `usuarios`, `politicas_acceso` | 403 `TABLE_NOT_ALLOWED` |
| Tabla de sistema | `sqlite_master` | 403 `TABLE_NOT_ALLOWED` |
| 3.er nivel AND/OR | grupo dentro de grupo dentro de grupo | 400 `TOO_DEEP` |
| Columna no agregada sin GROUP BY | `almacen_id` + `SUM(cantidad)` | 400 `GROUP_MISMATCH` |
| `SUM` sobre texto | `SUM(nombre)` | 400 `BAD_AGG` |
| `LIKE` sobre entero | `id LIKE '1%'` | 400 `BAD_OP` |
| `LIMIT` excesivo | 99 999 | 400 `BAD_LIMIT` |
| JOIN sin relación FK | `almacenes` + `proveedores` | 400 `NO_RELATION` |
| Operario evade RLS con OR | `almacen_id = 2 OR 3` | 0 filas |
| Operario pide costo | `costo_unitario` | 403 `COLUMN_NOT_ALLOWED` |
| Salida mayor al stock | cantidad 99 999 | 409 `INSUFFICIENT_STOCK` |
| Consulta registra movimiento | rol consulta | 403 `FORBIDDEN` |
| Sin sesión / token inválido | — | 401 `UNAUTHENTICATED` |

## Preguntas típicas y respuesta corta
- **¿Por qué no basta el validador anti-inyección?** No es la defensa principal: los valores solo viajan como parámetros y los identificadores salen de la whitelist. El validador es defensa en profundidad.
- **¿Cómo se cambia de motor?** `DB_ENGINE=postgres DATABASE_URL=… npm start`; solo cambian los archivos de `src/db/adapters/`.
- **¿La RLS es nativa?** No; SQLite no la tiene. Se inyecta un filtro obligatorio desde `politicas_acceso`.
- **¿Qué falta?** Probar el adaptador PostgreSQL contra un servidor real; expresiones entre columnas y subconsultas.

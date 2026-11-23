# SQL-INV — Motor de consultas SQL para inventario multi-almacén

Proyecto 1 · SW608 Lenguajes de Dominio Específico (UNI, 2026-II).
**DSL:** SQL embebido en Node.js mediante una capa de construcción dinámica (AST JSON → SQL parametrizado).
**Stack:** Node.js ≥ 22.13 · Express · SQLite (`node:sqlite`, sin compilación nativa) · Chart.js · adaptador PostgreSQL opcional.

## Ejecutar (clone → install → run)

```bash
npm install
npm start          # http://localhost:3000  (siembra el dataset en el primer arranque)
npm test           # pruebas automatizadas (node:test)
npm run seed       # re-siembra el dataset (determinista)
npm run demo:abstraccion   # JS puro (45 líneas) vs 1 sentencia SQL, con verificación de resultados idénticos
npm run demo:motor         # mismo AST compilado para SQLite y PostgreSQL
```

Usuarios de demostración (solo desarrollo):

| Usuario | Contraseña | Rol | Alcance |
|---|---|---|---|
| `admin` | `admin123` | admin | Todo; auditoría; registrar movimientos en cualquier almacén |
| `operario1` | `oper123` | operario | Solo filas de su almacén (RLS); sin `costo_unitario`/`costo_total`; puede registrar movimientos en su almacén |
| `consulta` | `cons123` | consulta | Solo lectura de todas las filas; sin columnas de costo |

Variables de entorno: `PORT` (3000), `TOKEN_SECRET` (si falta se genera uno efímero), `DB_ENGINE` (`sqlite`|`postgres`), `SQLITE_FILE`, `DATABASE_URL`.

## Mapa de requisitos verificables

| Requisito | Dónde | Verificación |
|---|---|---|
| SELECT, WHERE AND/OR anidado (2 niveles), GROUP BY, HAVING, ORDER BY | `public/app.js` (constructor) · `src/dsl/compiler.js` | `tests/dsl.test.js` |
| Validador: inyección + whitelist de tablas/columnas | `src/dsl/catalog.js`, `src/dsl/validator.js` | `tests/dsl.test.js`, pestaña *Seguridad* (8 ataques) |
| Consultas preparadas `?` (sin concatenar valores) | `src/dsl/compiler.js` | test “valor jamás entra al SQL”, test estático del compilador |
| Dashboard con 2 gráficos por agregaciones SQL | `src/dashboard.js`, pestaña *Dashboard* | `tests/security.test.js` |
| Control de acceso por rol con políticas en SQL | tabla `politicas_acceso`, `src/security/policies.js` | `tests/security.test.js` |
| Dataset: ≥5 tablas, ≥5 000 registros | `src/db/seed.js` → 6 tablas de dominio (~8 000 filas totales con seguridad) | test “seed” |
| 40+ líneas JS ↔ 1 SQL; cambiar de motor = tocar el adaptador | `demo/`, `src/db/adapters/` | `npm run demo:*`, test “ningún módulo conoce el motor” |

## Arquitectura

```
public/ (UI)  ──►  Express (src/app.js)
                     │  AST JSON
                     ▼
        validator.js (whitelist por rol + anti-inyección + tipos)
                     ▼
        compiler.js  (AST → SQL con "?" + params + filtros RLS inyectados)
                     ▼
        adapter  (src/db/adapters/{sqlite,postgres}.js)   ← única pieza que conoce el motor
```

* **Whitelist** (`catalog.js`): única fuente de identificadores. Nunca llega al SQL un nombre de tabla/columna que no esté allí.
* **Políticas** (`politicas_acceso`): `predicado` = filtro obligatorio (p. ej. `{t}.almacen_id = :almacen_id`) inyectado con `AND` en todo `WHERE`; `columnas_ocultas` = seguridad por columna. Los valores de la política también se parametrizan.
* **Auditoría**: toda consulta, rechazo y movimiento queda en `auditoria` (visible solo para admin).

## Cambiar de motor

```bash
DB_ENGINE=postgres DATABASE_URL=postgres://usuario:clave@host/db npm run seed
DB_ENGINE=postgres DATABASE_URL=... npm start
```

Se modificó únicamente `src/db/adapters/*` (traducción `?`→`$n`, `ILIKE`, pool/transacciones). El DDL de `src/db/schema.js` es portable. El adaptador PostgreSQL está cubierto con pruebas unitarias (mock del pool); no se ejecutó contra un servidor PostgreSQL real en este entorno.

## Límites conocidos

* La RLS es *inyección de filtros obligatorios* (opción permitida por el enunciado); SQLite no tiene RLS nativa.
* El validador anti-inyección es defensa en profundidad: la protección real es que los valores solo viajan como parámetros y los identificadores salen de la whitelist. Puede rechazar valores legítimos que contengan `;`, `--` o `/*`.
* No hay expresiones aritméticas entre columnas (p. ej. `cantidad * costo`) en el DSL.

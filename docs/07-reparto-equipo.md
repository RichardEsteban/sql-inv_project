# 7. Reparto del equipo (4 integrantes): archivos y orden de commits

La rúbrica evalúa el historial Git **por integrante**. Cada persona es dueña de un módulo, trabaja en su propia rama y entra a `main` con un Pull Request. Todos deben poder explicar su módulo sin leer en la defensa.

> Estado actual: `main` ya tiene una versión base integrada (commits iniciales de Richard Esteban). Los commits de la lista de cada integrante son **trabajo adicional real sobre su módulo** (pruebas, refactor, documentación). Cada quien los hace con su propio usuario de Git; no se reescribe el historial ni se firma por otra persona.

## Orden de integración (dependencias)
```
PR-1 Integrante 1 (núcleo DSL)  ─►  PR-2 Integrante 2 (compilador/motores)
                                        ─►  PR-3 Integrante 3 (seguridad/API/datos)
                                                 ─►  PR-4 Integrante 4 (UI/dashboard/CI/demo)
```
Convención de commits: `tipo(módulo): mensaje` (`feat`, `fix`, `test`, `docs`, `refactor`, `ci`). Ramas: `feature/<módulo>`. Un PR por rama, con revisión de otro integrante.

---

## Integrante 1 — Núcleo del DSL: catálogo y validador
**Rama:** `feature/dsl-validator` · **Defiende:** whitelist, validador anti-inyección, metamodelo.

| Archivos propios |
|---|
| `src/dsl/catalog.js`, `src/dsl/errors.js`, `src/dsl/validator.js` |
| `tests/dsl.test.js` |
| `docs/01-bases-teoricas.md`, `docs/04-metamodelo/*` (`metamodelo-uml.png`, `mapeo-sintaxis.md`) |

**Orden de commits**
1. `feat(catalog): whitelist de tablas, columnas, relaciones y operadores por tipo`
2. `feat(validator): validación estructural del AST (claves conocidas, límites)`
3. `feat(validator): autorización por catálogo (TABLE_NOT_ALLOWED / COLUMN_NOT_ALLOWED)`
4. `feat(validator): heurística anti-inyección y coerción de tipos`
5. `feat(validator): coherencia GROUP BY / HAVING y límite de 2 niveles AND/OR`
6. `test(dsl): casos de rechazo y borde (BETWEEN, IN, fechas, alias)`
7. `docs(metamodelo): diagrama UML, metaclases, OCL y mapeo a SQL`
8. `docs(bases): bases teóricas y referencias`

## Integrante 2 — Compilador y adaptadores de motor
**Rama:** `feature/dsl-compiler` · **Defiende:** AST → SQL con `?`, criterio "40+ líneas vs 1 SQL", cambio de motor.

| Archivos propios |
|---|
| `src/dsl/compiler.js`, `src/dsl/index.js` |
| `src/db/adapters/sqlite.js`, `src/db/adapters/postgres.js`, `src/db/index.js`, `src/db/schema.js` |
| `tests/adapter.test.js`, `demo/js-puro-vs-sql.js`, `demo/swap-engine.js` |
| `docs/02-justificacion-dsl.md`, `docs/03-demostracion-abstraccion.md` |

**Orden de commits**
1. `feat(db): DDL portable para SQLite y PostgreSQL`
2. `feat(adapter): adaptador SQLite con node:sqlite y transacciones serializadas`
3. `feat(compiler): SELECT/JOIN/WHERE anidado/GROUP BY/HAVING/ORDER BY con parámetros ?`
4. `feat(compiler): operadores IN, BETWEEN, LIKE y LIMIT parametrizado`
5. `feat(adapter): adaptador PostgreSQL (? → $n, ILIKE, pool y transacciones)`
6. `test(adapter): mismo AST en dos motores y ningún módulo fuera de adapters conoce el motor`
7. `docs(demo): script JS puro vs SQL y cambio de motor`
8. `docs(dsl): justificación y demostración de abstracción`

## Integrante 3 — Seguridad, API y datos
**Rama:** `feature/security-rls` · **Defiende:** roles/RLS en SQL, auditoría, dataset semilla, casos de uso.

| Archivos propios |
|---|
| `src/security/policies.js`, `src/security/auth.js` |
| `src/db/seed.js`, `scripts/seed.js` |
| `src/app.js`, `src/server.js` |
| `tests/security.test.js`, `tests/helpers.js` |
| `docs/05-requisitos/caso-de-uso.md`, `docs/05-requisitos/historias-de-usuario.md` |

**Orden de commits**
1. `feat(seed): dataset determinista (6 tablas de dominio, ~8 000 registros)`
2. `feat(auth): hash scrypt y tokens firmados HMAC`
3. `feat(policies): políticas SQL con predicado RLS y columnas ocultas`
4. `feat(api): login, /schema, /query/compile y /query/run con control por rol`
5. `feat(api): movimientos con transacción y reglas de stock; auditoría`
6. `test(security): RLS, columnas ocultas, 401/403 y auditoría`
7. `docs(requisitos): caso de uso UC-001 y 3 HU en Given/When/Then`

## Integrante 4 — Interfaz, dashboard, CI y demo
**Rama:** `feature/ui-dashboard` · **Defiende:** constructor visual, 2 gráficos por agregaciones, guion de demo.

| Archivos propios |
|---|
| `public/index.html`, `public/styles.css`, `public/app.js` |
| `src/dashboard.js` |
| `.github/workflows/test.yml`, `README.md`, `package.json` |
| `docs/06-guion-demo.md`, `docs/img/*` |

**Orden de commits**
1. `chore: estructura del proyecto, package.json y .gitignore`
2. `feat(ui): constructor visual (FROM/JOIN, SELECT, WHERE anidado, GROUP BY/HAVING, ORDER BY)`
3. `feat(ui): SQL en vivo, tabla de resultados y gráfico del resultado`
4. `feat(dashboard): stock por almacén y rotación por categoría desde agregaciones SQL`
5. `feat(ui): pestaña de pruebas de ataque y auditoría`
6. `ci: workflow de GitHub Actions para las pruebas`
7. `docs(demo): guion de 14 pasos y casos borde para la defensa`
8. `docs(readme): instrucciones clone → install → run y mapa de requisitos`

---

## Reglas para que la contribución sea verificable
- Cada integrante hace **sus** commits con su usuario/correo de Git (`git config user.name` / `user.email`).
- Mínimo 6 commits sustantivos por persona, repartidos en varios días; nada de un único commit grande.
- Los PRs se revisan entre integrantes antes del merge; `npm test` debe pasar (el CI lo comprueba).
- Antes de la defensa, cada uno repasa su sección y los casos borde de [06-guion-demo.md](06-guion-demo.md).

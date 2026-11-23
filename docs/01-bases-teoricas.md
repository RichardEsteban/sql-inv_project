# 1. Bases teóricas y fundamentación

## 1.1 Lenguajes de dominio específico
Un DSL es un lenguaje pequeño pensado para un dominio concreto (Fowler, 2010). Pueden ser **externos** (sintaxis y parser propios) o **internos/embebidos** (se construyen dentro de un lenguaje anfitrión). Aquí el anfitrión es JavaScript (Node.js) y el DSL es **SQL**: el usuario describe *qué* datos quiere y el motor decide *cómo* obtenerlos.

## 1.2 SQL y álgebra relacional
| Cláusula SQL | Operación relacional |
|---|---|
| `SELECT` | proyección (π) |
| `WHERE` | selección (σ) |
| `JOIN` | reunión (⋈) |
| `GROUP BY` + agregados | agrupación (γ) |
| `HAVING` | filtro de grupos |

El constructor visual expone justamente estas operaciones, de modo que lo que el usuario arma en pantalla se parece a lo que termina ejecutándose.

## 1.3 Inyección SQL y consultas preparadas
La inyección SQL ocurre cuando un dato del usuario se interpreta como parte de la sentencia (OWASP A03). La defensa principal es la **consulta preparada**: la sentencia lleva marcadores `?` y los valores viajan aparte. Los nombres de tablas y columnas **no** se pueden parametrizar, por eso se resuelven contra una **whitelist** (`src/dsl/catalog.js`): el nombre que llega al SQL sale del catálogo, no del texto recibido.

## 1.4 Control de acceso por rol
RBAC con tres roles (`admin`, `operario`, `consulta`). Las restricciones se expresan en SQL en la tabla `politicas_acceso`:
- un **predicado** por rol y tabla (ej. `{t}.almacen_id = :almacen_id`) que se agrega siempre al `WHERE` (Row-Level Security emulada);
- una lista de **columnas ocultas** por rol (seguridad por columna).

SQLite no tiene RLS nativa, por eso se emula con filtros obligatorios (opción admitida por el enunciado).

## 1.5 Metamodelado y patrón Adapter
El metamodelo del DSL (ver [04-metamodelo](04-metamodelo/mapeo-sintaxis.md)) sigue el enfoque MOF: metaclases, metasociaciones y restricciones. La independencia del motor se logra con el patrón **Adapter**: el compilador genera SQL con `?` y solo pide al adaptador el dialecto; ejecución, transacciones y conversión `?` → `$n` viven en `src/db/adapters/`.

## Referencias
- Fowler, M. (2010). *Domain-Specific Languages*. Addison-Wesley.
- OWASP. *SQL Injection Prevention Cheat Sheet* y *OWASP Top 10*.
- Date, C. J. *An Introduction to Database Systems*. Pearson.
- Gamma et al. (1994). *Design Patterns* (Adapter).
- Documentación de Node.js (`node:sqlite`, `node:test`), SQLite y PostgreSQL (Row Security Policies).

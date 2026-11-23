# 3. Demostración de abstracción

**Enunciado de prueba:** por almacén y categoría, unidades en stock y número de ítems, solo para Electrónica, Herramientas y Textil con stock > 10, grupos con al menos 100 unidades, los 10 primeros.

Ejecutable: `npm run demo:abstraccion` (`demo/js-puro-vs-sql.js`) corre ambas versiones sobre el dataset y compara resultados.

## Sin DSL: JavaScript puro (45 líneas)
Ver la función `consultaJsPuro` en [`demo/js-puro-vs-sql.js`](../demo/js-puro-vs-sql.js): crea tres `Map` de índices, recorre `stock`, hace los tres joins a mano, filtra, acumula en un `Map` de grupos, aplica el `HAVING`, ordena con desempates y corta a 10.

## Con DSL: AST que envía la interfaz
```js
{ from: 'stock',
  joins: [{table:'productos'}, {table:'categorias'}, {table:'almacenes'}],
  select: [ {table:'almacenes', column:'nombre', alias:'almacen'},
            {table:'categorias', column:'nombre', alias:'categoria'},
            {table:'stock', column:'cantidad', agg:'SUM', alias:'unidades'},
            {agg:'COUNT', column:'*', alias:'items'} ],
  where: { op:'AND', items: [
    {table:'stock', column:'cantidad', op:'>', value:10},
    {table:'categorias', column:'nombre', op:'IN', value:['Electrónica','Herramientas','Textil']} ]},
  groupBy: [{table:'almacenes',column:'nombre'}, {table:'categorias',column:'nombre'}],
  having: { op:'AND', items:[{agg:'SUM', table:'stock', column:'cantidad', op:'>=', value:100}] },
  orderBy: [{alias:'unidades', dir:'DESC'}], limit: 10 }
```

## SQL generado (1 sentencia, 10 líneas)
```sql
SELECT "almacenes"."nombre" AS "almacen", "categorias"."nombre" AS "categoria",
       SUM("stock"."cantidad") AS "unidades", COUNT(*) AS "items"
FROM "stock"
INNER JOIN "productos" ON "stock"."producto_id" = "productos"."id"
INNER JOIN "categorias" ON "productos"."categoria_id" = "categorias"."id"
INNER JOIN "almacenes" ON "stock"."almacen_id" = "almacenes"."id"
WHERE ("stock"."cantidad" > ? AND "categorias"."nombre" IN (?, ?, ?))
GROUP BY "almacenes"."nombre", "categorias"."nombre"
HAVING SUM("stock"."cantidad") >= ?
ORDER BY "unidades" DESC, "almacen" ASC, "categoria" ASC
LIMIT ?   -- params: [10, "Electrónica", "Herramientas", "Textil", 100, 10]
```

## Resultado medido
| Métrica | JS puro | SQL (DSL) |
|---|---|---|
| Líneas de la solución | 45 | 10 (1 sentencia) |
| Filas llevadas a Node | tablas completas (~2 000) | solo el resultado (≤ 10) |
| Resultados idénticos | — | Sí (verificado por el script) |

## Cambiar de motor: solo el adaptador
`npm run demo:motor` compila el mismo AST para ambos motores:
```
sqlite                                  postgres
WHERE "productos"."nombre" LIKE ?       WHERE "productos"."nombre" ILIKE $1
LIMIT ?                                 LIMIT $2
```
La prueba `criterio de éxito: ningún módulo fuera de src/db/adapters conoce el motor` falla si algún archivo fuera de `src/db/adapters/` importa `node:sqlite` o `pg`.

> Nota: el adaptador de PostgreSQL se probó con un pool simulado (mock), no contra un servidor PostgreSQL real.

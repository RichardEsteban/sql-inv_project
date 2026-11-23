import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, USERS } from './helpers.js';
import { buildQuery, runQuery } from '../src/dsl/index.js';

let adapter; let counts;
before(async () => { ({ adapter, counts } = await makeDb()); });
after(async () => { await adapter.close(); });

const complejaAST = {
  from: 'stock',
  joins: [{ table: 'productos' }, { table: 'categorias' }, { table: 'almacenes' }],
  select: [
    { table: 'almacenes', column: 'nombre', alias: 'almacen' },
    { table: 'categorias', column: 'nombre', alias: 'categoria' },
    { table: 'stock', column: 'cantidad', agg: 'SUM', alias: 'unidades' },
    { agg: 'COUNT', column: '*', alias: 'items' },
  ],
  where: {
    op: 'AND',
    items: [
      { table: 'stock', column: 'cantidad', op: '>', value: 10 },
      { op: 'OR', items: [
        { table: 'categorias', column: 'nombre', op: '=', value: 'Electrónica' },
        { table: 'categorias', column: 'nombre', op: 'IN', value: ['Herramientas', 'Textil'] },
      ] },
    ],
  },
  groupBy: [{ table: 'almacenes', column: 'nombre' }, { table: 'categorias', column: 'nombre' }],
  having: { op: 'AND', items: [{ agg: 'SUM', table: 'stock', column: 'cantidad', op: '>=', value: 100 }] },
  orderBy: [{ alias: 'unidades', dir: 'DESC' }],
  limit: 10,
};

test('seed: ≥5 tablas relacionadas y ≥5000 registros', () => {
  const dominio = ['almacenes', 'categorias', 'proveedores', 'productos', 'stock', 'movimientos'];
  assert.ok(dominio.length >= 5);
  const filas = dominio.reduce((a, t) => a + counts[t], 0);
  assert.ok(filas >= 5000, `filas=${filas}`);
});

test('compila SELECT + JOIN + WHERE anidado + GROUP BY + HAVING + ORDER BY con parámetros ?', async () => {
  const b = await buildQuery(adapter, USERS.admin, complejaAST);
  assert.match(b.sql, /^SELECT /);
  for (const kw of ['INNER JOIN', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT ?']) assert.ok(b.sql.includes(kw), kw);
  assert.match(b.sql, /\(\s*"categorias"\."nombre" = \? OR "categorias"\."nombre" IN \(\?, \?\)\s*\)/);
  // 10 | Electrónica | Herramientas | Textil | 100 | 10(limit)
  assert.deepEqual(b.params, [10, 'Electrónica', 'Herramientas', 'Textil', 100, 10]);
  // ningún valor literal viaja dentro del SQL
  for (const v of ['Electrónica', 'Herramientas', 'Textil']) assert.ok(!b.sql.includes(v));
});

test('ejecuta y devuelve filas ordenadas', async () => {
  const r = await runQuery(adapter, USERS.admin, complejaAST);
  assert.ok(r.rowCount > 0 && r.rowCount <= 10);
  const u = r.rows.map((x) => x.unidades);
  assert.deepEqual(u, [...u].sort((a, b) => b - a));
  assert.deepEqual(r.columns.map((c) => c.name), ['almacen', 'categoria', 'unidades', 'items']);
});

test('placeholders == parámetros', async () => {
  const b = await buildQuery(adapter, USERS.operario, complejaAST);
  assert.equal((b.sql.match(/\?/g) ?? []).length, b.params.length);
});

test('limita el anidamiento AND/OR a 2 niveles', async () => {
  const deep = { from: 'stock', select: [{ table: 'stock', column: 'id' }], where: { op: 'AND', items: [
    { op: 'OR', items: [{ op: 'AND', items: [{ table: 'stock', column: 'id', op: '=', value: 1 }] }] },
  ] } };
  await assert.rejects(buildQuery(adapter, USERS.admin, deep), { code: 'TOO_DEEP' });
});

test('rechaza tablas y columnas fuera de la whitelist', async () => {
  const base = { select: [{ table: 'usuarios', column: 'password_hash' }] };
  await assert.rejects(buildQuery(adapter, USERS.admin, { ...base, from: 'usuarios' }), { code: 'TABLE_NOT_ALLOWED' });
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'politicas_acceso', select: [{ table: 'politicas_acceso', column: 'rol' }] }), { code: 'TABLE_NOT_ALLOWED' });
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'sqlite_master', select: [{ table: 'sqlite_master', column: 'name' }] }), { code: 'TABLE_NOT_ALLOWED' });
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'productos', select: [{ table: 'productos', column: 'secreto' }] }), { code: 'COLUMN_NOT_ALLOWED' });
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'productos; DROP TABLE productos', select: [{ table: 'productos', column: 'id' }] }), { code: 'BAD_TABLE' });
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'productos', select: [{ table: 'productos', column: 'id"--' }] }), { code: 'BAD_FIELD' });
});

test('rechaza patrones de inyección en valores y alias', async () => {
  const q = (value) => ({ from: 'productos', select: [{ table: 'productos', column: 'id' }],
    where: { op: 'AND', items: [{ table: 'productos', column: 'nombre', op: '=', value }] } });
  for (const evil of ["' OR 1=1 --", "x'; DROP TABLE productos; --", "1 UNION SELECT password_hash FROM usuarios", "a' OR 'a'='a", '/* x */']) {
    await assert.rejects(buildQuery(adapter, USERS.admin, q(evil)), { code: 'INJECTION_SUSPECT' }, evil);
  }
  await assert.rejects(buildQuery(adapter, USERS.admin, {
    from: 'productos', select: [{ table: 'productos', column: 'id', alias: 'x; DROP TABLE productos' }] }), { code: 'BAD_ALIAS' });
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'productos', select: [{ table: 'productos', column: 'id' }], extra: 1 }), { code: 'UNKNOWN_KEY' });
});

test('defensa en profundidad: aunque el validador no detectara el ataque, el valor jamás entra al SQL', async () => {
  // Valor "raro" que pasa las heurísticas pero contiene comillas simples.
  const r = await runQuery(adapter, USERS.admin, { from: 'productos', select: [{ table: 'productos', column: 'id' }],
    where: { op: 'AND', items: [{ table: 'productos', column: 'nombre', op: '=', value: "O'Brien" }] } });
  assert.equal(r.rowCount, 0);
  assert.ok(!r.sql.includes("O'Brien"));
  assert.deepEqual(r.params, ["O'Brien", 200]);
});

test('coherencia GROUP BY / HAVING / tipos', async () => {
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'stock', select: [{ table: 'stock', column: 'almacen_id' }, { table: 'stock', column: 'cantidad', agg: 'SUM' }] }), { code: 'GROUP_MISMATCH' });
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'productos', select: [{ table: 'productos', column: 'nombre', agg: 'SUM' }], groupBy: [] }), { code: 'BAD_AGG' });
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'productos', select: [{ table: 'productos', column: 'id' }], having: { op: 'AND', items: [{ agg: 'COUNT', column: '*', op: '>', value: 1 }] } }), { code: 'BAD_HAVING' });
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'productos', select: [{ table: 'productos', column: 'id' }], where: { op: 'AND', items: [{ table: 'productos', column: 'id', op: 'LIKE', value: '1%' }] } }), { code: 'BAD_OP' });
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'productos', select: [{ table: 'productos', column: 'id' }], limit: 99999 }), { code: 'BAD_LIMIT' });
  await assert.rejects(buildQuery(adapter, USERS.admin, { from: 'almacenes', joins: [{ table: 'proveedores' }], select: [{ table: 'almacenes', column: 'id' }] }), { code: 'NO_RELATION' });
});

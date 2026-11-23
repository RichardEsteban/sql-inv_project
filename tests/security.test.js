import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, startApp, USERS } from './helpers.js';
import { runQuery, buildQuery } from '../src/dsl/index.js';

let adapter; let app;
before(async () => { ({ adapter } = await makeDb()); app = await startApp(adapter); });
after(async () => { await app.close(); await adapter.close(); });

const stockPorAlmacen = {
  from: 'stock', joins: [{ table: 'almacenes' }],
  select: [{ table: 'almacenes', column: 'nombre', alias: 'almacen' }, { table: 'stock', column: 'cantidad', agg: 'SUM', alias: 'u' }],
  groupBy: [{ table: 'almacenes', column: 'nombre' }],
};

test('RLS: admin ve 5 almacenes; operario ve solo el suyo; consulta ve todos', async () => {
  assert.equal((await runQuery(adapter, USERS.admin, stockPorAlmacen)).rowCount, 5);
  const op = await runQuery(adapter, USERS.operario, stockPorAlmacen);
  assert.equal(op.rowCount, 1);
  assert.equal(op.rows[0].almacen, 'Almacén Lima Centro');
  assert.equal((await runQuery(adapter, USERS.consulta, stockPorAlmacen)).rowCount, 5);
});

test('RLS: el filtro obligatorio va en el SQL y usa parámetro', async () => {
  const b = await buildQuery(adapter, USERS.operario, stockPorAlmacen);
  assert.match(b.sql, /WHERE\s+\("stock"\."almacen_id" = \?\)\s+AND\s+\("almacenes"."id" = \?\)/);
  assert.deepEqual(b.params.slice(0, 2), [1, 1]);
  assert.ok(b.policies.length === 2);
});

test('RLS no se puede evadir con OR del usuario (se aplica con AND y condiciones entre paréntesis)', async () => {
  const q = { from: 'stock', select: [{ table: 'stock', column: 'almacen_id' }], limit: 1000,
    where: { op: 'OR', items: [
      { table: 'stock', column: 'almacen_id', op: '=', value: 2 },
      { table: 'stock', column: 'almacen_id', op: '=', value: 3 },
    ] } };
  const r = await runQuery(adapter, USERS.operario, q);
  assert.equal(r.rowCount, 0); // operario1 (almacén 1) no puede ver filas de 2 ni 3
});

test('column-level: operario/consulta no pueden leer ni filtrar costo_unitario', async () => {
  for (const u of [USERS.operario, USERS.consulta]) {
    await assert.rejects(runQuery(adapter, u, { from: 'productos', select: [{ table: 'productos', column: 'costo_unitario' }] }), { code: 'COLUMN_NOT_ALLOWED' });
    await assert.rejects(runQuery(adapter, u, { from: 'productos', select: [{ table: 'productos', column: 'id' }],
      where: { op: 'AND', items: [{ table: 'productos', column: 'costo_unitario', op: '>', value: 1 }] } }), { code: 'COLUMN_NOT_ALLOWED' });
  }
  assert.ok((await runQuery(adapter, USERS.admin, { from: 'productos', select: [{ table: 'productos', column: 'costo_unitario' }] })).rowCount > 0);
  await assert.rejects(runQuery(adapter, USERS.consulta, { from: 'movimientos', select: [{ table: 'movimientos', column: 'costo_total', agg: 'SUM' }] }), { code: 'COLUMN_NOT_ALLOWED' });
});

test('API: login, token y errores 401/403', async () => {
  assert.equal((await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'mala' } })).status, 401);
  assert.equal((await app.call('POST', '/api/query/run', { body: stockPorAlmacen })).status, 401);
  const tc = await app.login('consulta', 'cons123');
  assert.equal((await app.call('GET', '/api/audit', { token: tc })).status, 403);
  assert.equal((await app.call('POST', '/api/movimientos', { token: tc, body: { producto_id: 1, tipo: 'ENTRADA', cantidad: 1 } })).status, 403);
  const ta = await app.login('admin', 'admin123');
  assert.equal((await app.call('GET', '/api/audit', { token: ta })).status, 200);
  assert.equal((await app.call('POST', '/api/query/run', { token: 'x.y', body: stockPorAlmacen })).status, 401);
});

test('API: tabla no autorizada => 403; inyección => 400; todo queda en auditoría', async () => {
  const t = await app.login('admin', 'admin123');
  const r1 = await app.call('POST', '/api/query/run', { token: t, body: { from: 'usuarios', select: [{ table: 'usuarios', column: 'password_hash' }] } });
  assert.equal(r1.status, 403);
  assert.equal(r1.body.error.code, 'TABLE_NOT_ALLOWED');
  const r2 = await app.call('POST', '/api/query/run', { token: t, body: { from: 'productos', select: [{ table: 'productos', column: 'id' }],
    where: { op: 'AND', items: [{ table: 'productos', column: 'nombre', op: '=', value: "' OR 1=1 --" }] } } });
  assert.equal(r2.status, 400);
  assert.equal(r2.body.error.code, 'INJECTION_SUSPECT');
  const audit = (await app.call('GET', '/api/audit', { token: t })).body.rows;
  assert.ok(audit.some((a) => a.ok === 0 && /TABLE_NOT_ALLOWED/.test(a.detalle)));
  assert.ok(audit.some((a) => a.ok === 0 && /INJECTION_SUSPECT/.test(a.detalle)));
});

test('API: /schema oculta columnas y /dashboard respeta RLS', async () => {
  const to = await app.login('operario1', 'oper123');
  const sch = (await app.call('GET', '/api/schema', { token: to })).body;
  assert.ok(!('costo_unitario' in sch.tables.productos.columns));
  assert.ok(!('usuarios' in sch.tables));
  const dash = (await app.call('GET', '/api/dashboard', { token: to })).body;
  assert.equal(dash.stockPorAlmacen.rows.length, 1);
  const ta = await app.login('admin', 'admin123');
  const dashA = (await app.call('GET', '/api/dashboard', { token: ta })).body;
  assert.equal(dashA.stockPorAlmacen.rows.length, 5);
  assert.equal(dashA.rotacionPorCategoria.rows.length, 10);
  assert.ok(dashA.kpis.productos > 300);
});

test('API: movimientos del operario quedan forzados a su almacén y validan stock', async () => {
  const t = await app.login('operario1', 'oper123');
  const [s] = await adapter.all('SELECT producto_id, cantidad FROM stock WHERE almacen_id = 1 LIMIT 1');
  // intento de actuar sobre otro almacén: se ignora el almacen_id del cuerpo
  const ok = await app.call('POST', '/api/movimientos', { token: t, body: { producto_id: s.producto_id, almacen_id: 2, tipo: 'ENTRADA', cantidad: 5 } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.stock_resultante, s.cantidad + 5);
  const over = await app.call('POST', '/api/movimientos', { token: t, body: { producto_id: s.producto_id, tipo: 'SALIDA', cantidad: 999999 } });
  assert.equal(over.status, 400); // cantidad fuera de rango
  const over2 = await app.call('POST', '/api/movimientos', { token: t, body: { producto_id: s.producto_id, tipo: 'SALIDA', cantidad: 99999 } });
  assert.equal(over2.status, 409);
});

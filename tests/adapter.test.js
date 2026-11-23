import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PostgresAdapter } from '../src/db/adapters/postgres.js';
import { SqliteAdapter } from '../src/db/adapters/sqlite.js';
import { validateQuery } from '../src/dsl/validator.js';
import { compileQuery } from '../src/dsl/compiler.js';
import { CATALOG } from '../src/dsl/catalog.js';

const ast = {
  from: 'productos', select: [{ table: 'productos', column: 'nombre' }],
  where: { op: 'AND', items: [{ table: 'productos', column: 'nombre', op: 'LIKE', value: 'cab%' }, { table: 'productos', column: 'id', op: 'IN', value: [1, 2] }] },
};

test('mismo AST, dos motores: solo cambia el dialecto aportado por el adaptador', () => {
  const norm = validateQuery(ast, CATALOG);
  const sqlite = compileQuery(norm, { dialect: new SqliteAdapter({ file: ':memory:' }).dialect });
  const pg = compileQuery(norm, { dialect: new PostgresAdapter({ pool: null }).dialect });
  assert.match(sqlite.sql, /"productos"\."nombre" LIKE \?/);
  assert.match(pg.sql, /"productos"\."nombre" ILIKE \?/);
  assert.deepEqual(sqlite.params, pg.params);
  assert.equal(PostgresAdapter.toNumbered(pg.sql).match(/\$\d+/g).length, pg.params.length);
});

test('PostgresAdapter traduce ? a $n y delega en pool.query (mock)', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push([sql, params]); return { rows: [{ a: 1 }], rowCount: 1 }; } };
  const pg = new PostgresAdapter({ pool });
  assert.deepEqual(await pg.all('SELECT * FROM t WHERE a = ? AND b = ?', [1, 2]), [{ a: 1 }]);
  assert.equal(calls[0][0], 'SELECT * FROM t WHERE a = $1 AND b = $2');
});

test('criterio de éxito: ningún módulo fuera de src/db/adapters conoce el motor', () => {
  const root = path.resolve('src');
  const offenders = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) { if (!p.endsWith(path.join('db', 'adapters'))) walk(p); continue; }
      const txt = readFileSync(p, 'utf8');
      if (/from ['"](node:sqlite|pg|better-sqlite3)['"]|import\(['"]pg['"]\)/.test(txt)) offenders.push(p);
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});

test('prohibida la concatenación de valores: el compilador solo interpola identificadores de la whitelist', () => {
  const src = readFileSync('src/dsl/compiler.js', 'utf8');
  // los únicos `${...}` permitidos en el compilador envuelven identificadores/expresiones ya compiladas
  assert.ok(!/\$\{[^}]*values\[[^}]*\}/.test(src), 'valor interpolado en plantilla');
  assert.ok(!/\$\{\s*c\.values\s*\}/.test(src), 'valores interpolados en plantilla');
});

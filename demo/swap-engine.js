// Demostración: cambiar de motor solo exige tocar el adaptador.
//   npm run demo:motor
import { readdirSync } from 'node:fs';
import { SqliteAdapter } from '../src/db/adapters/sqlite.js';
import { PostgresAdapter } from '../src/db/adapters/postgres.js';
import { validateQuery } from '../src/dsl/validator.js';
import { compileQuery } from '../src/dsl/compiler.js';
import { CATALOG } from '../src/dsl/catalog.js';

const ast = {
  from: 'productos',
  select: [{ table: 'productos', column: 'nombre' }],
  where: { op: 'AND', items: [{ table: 'productos', column: 'nombre', op: 'LIKE', value: 'cable%' }] },
  limit: 5,
};
const norm = validateQuery(ast, CATALOG);

const motores = {
  sqlite: new SqliteAdapter({ file: ':memory:' }),
  postgres: new PostgresAdapter({ pool: null }),
};

for (const [nombre, adapter] of Object.entries(motores)) {
  const { sql, params } = compileQuery(norm, { dialect: adapter.dialect });
  const final = nombre === 'postgres' ? PostgresAdapter.toNumbered(sql) : sql;
  console.log(`--- ${nombre} ---\n${final}\nparams=${JSON.stringify(params)}\n`);
}

console.log('Archivos que conocen el motor (únicos a tocar al migrar):');
for (const f of readdirSync(new URL('../src/db/adapters/', import.meta.url))) console.log('  src/db/adapters/' + f);
console.log('\nPara arrancar sobre PostgreSQL:  DB_ENGINE=postgres DATABASE_URL=postgres://... npm start');

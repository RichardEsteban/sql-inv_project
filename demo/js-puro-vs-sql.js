// Demostración de abstracción: la MISMA consulta en JS puro (arreglos + bucles) y en el DSL.
// Ejecuta ambas, comprueba que devuelven lo mismo y cuenta líneas.
//   npm run demo:abstraccion
import { SqliteAdapter } from '../src/db/adapters/sqlite.js';
import { seedDatabase } from '../src/db/seed.js';
import { runQuery } from '../src/dsl/index.js';

const adapter = new SqliteAdapter({ file: ':memory:' });
await seedDatabase(adapter);
const admin = { id: 1, username: 'admin', rol: 'admin', almacen_id: null };

// Enunciado: "Por almacén y categoría, unidades en stock y nº de ítems, solo para
// Electrónica/Herramientas/Textil con stock > 10, grupos con ≥ 100 unidades, top 10 por unidades".

// ------------------------- (A) JS PURO -------------------------------------------------
// Se asume que ya se cargaron las tablas completas en memoria (SELECT * x4).
function consultaJsPuro(stock, productos, categorias, almacenes) {
  for (const t of [stock, productos, categorias, almacenes]) {
    if (!Array.isArray(t)) throw new TypeError('tabla no cargada'); // sin esquema ni tipos
  }
  const prodPorId = new Map();                         // 1. índice de productos
  for (const p of productos) prodPorId.set(p.id, p);
  const catPorId = new Map();                          // 2. índice de categorías
  for (const c of categorias) catPorId.set(c.id, c);
  const almPorId = new Map();                          // 3. índice de almacenes
  for (const a of almacenes) almPorId.set(a.id, a);
  const permitidas = [
    'Electrónica',
    'Herramientas',
    'Textil',
  ];
  const grupos = new Map();                            // 4. acumulador GROUP BY
  for (const s of stock) {                             // 5. recorrer "fact table"
    if (!(s.cantidad > 10)) continue;                  //    WHERE stock.cantidad > 10
    const p = prodPorId.get(s.producto_id);            //    JOIN productos
    if (!p) continue;
    const c = catPorId.get(p.categoria_id);            //    JOIN categorias
    if (!c) continue;
    const a = almPorId.get(s.almacen_id);              //    JOIN almacenes
    if (!a) continue;
    if (!permitidas.includes(c.nombre)) continue;      //    WHERE categoria IN (...)
    const clave = a.nombre + '||' + c.nombre;          //    clave compuesta
    let g = grupos.get(clave);
    if (!g) {
      g = { almacen: a.nombre, categoria: c.nombre, unidades: 0, items: 0 };
      grupos.set(clave, g);
    }
    g.unidades += s.cantidad;                          //    SUM
    g.items += 1;                                      //    COUNT(*)
  }
  const salida = [];                                   // 6. HAVING
  for (const g of grupos.values()) {
    if (g.unidades >= 100) salida.push(g);
  }
  salida.sort((x, y) => {                              // 7. ORDER BY unidades DESC
    if (y.unidades !== x.unidades) return y.unidades - x.unidades;
    if (x.almacen !== y.almacen) return x.almacen < y.almacen ? -1 : 1;
    return x.categoria < y.categoria ? -1 : x.categoria > y.categoria ? 1 : 0;
  });
  return salida.slice(0, 10);                          // 8. LIMIT 10
}

// ------------------------- (B) DSL (AST -> SQL parametrizado) -------------------------
const ast = {
  from: 'stock',
  joins: [{ table: 'productos' }, { table: 'categorias' }, { table: 'almacenes' }],
  select: [
    { table: 'almacenes', column: 'nombre', alias: 'almacen' },
    { table: 'categorias', column: 'nombre', alias: 'categoria' },
    { table: 'stock', column: 'cantidad', agg: 'SUM', alias: 'unidades' },
    { agg: 'COUNT', column: '*', alias: 'items' },
  ],
  where: { op: 'AND', items: [
    { table: 'stock', column: 'cantidad', op: '>', value: 10 },
    { table: 'categorias', column: 'nombre', op: 'IN', value: ['Electrónica', 'Herramientas', 'Textil'] },
  ] },
  groupBy: [{ table: 'almacenes', column: 'nombre' }, { table: 'categorias', column: 'nombre' }],
  having: { op: 'AND', items: [{ agg: 'SUM', table: 'stock', column: 'cantidad', op: '>=', value: 100 }] },
  orderBy: [{ alias: 'unidades', dir: 'DESC' }, { alias: 'almacen' }, { alias: 'categoria' }],
  limit: 10,
};

const dsl = await runQuery(adapter, admin, ast);
const js = consultaJsPuro(
  await adapter.all('SELECT * FROM stock'), await adapter.all('SELECT * FROM productos'),
  await adapter.all('SELECT * FROM categorias'), await adapter.all('SELECT * FROM almacenes'),
);

const norm = (rows) => JSON.stringify(rows.map((r) => [r.almacen, r.categoria, Number(r.unidades), Number(r.items)]));
const iguales = norm(dsl.rows) === norm(js);
const lineasJs = consultaJsPuro.toString().split('\n').length;
const lineasSql = dsl.sql.split('\n').length;

console.log('=== SQL generado por el DSL (parámetros ?) ===');
console.log(dsl.sql);
console.log('parámetros:', JSON.stringify(dsl.params));
console.log('\n=== Resultado (primeras filas) ===');
console.table(dsl.rows.slice(0, 5));
console.log(`JS puro : ${lineasJs} líneas`);
console.log(`SQL     : ${lineasSql} líneas (1 sentencia)`);
console.log(`Resultados idénticos: ${iguales ? 'SÍ' : 'NO'}`);
await adapter.close();
process.exit(iguales && lineasJs >= 40 ? 0 : 1);

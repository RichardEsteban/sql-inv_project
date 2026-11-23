// El dashboard también usa el DSL: cada gráfico es un AST compilado a SQL con
// agregaciones (SUM/COUNT + GROUP BY) y sujeto a las mismas políticas por rol.
import { runQuery } from './dsl/index.js';

const stockPorAlmacen = {
  from: 'stock',
  joins: [{ table: 'almacenes' }],
  select: [
    { table: 'almacenes', column: 'nombre', alias: 'almacen' },
    { table: 'stock', column: 'cantidad', agg: 'SUM', alias: 'unidades' },
  ],
  groupBy: [{ table: 'almacenes', column: 'nombre' }],
  orderBy: [{ alias: 'unidades', dir: 'DESC' }],
};

const salidasPorCategoria = {
  from: 'movimientos',
  joins: [{ table: 'productos' }, { table: 'categorias' }],
  select: [
    { table: 'categorias', column: 'nombre', alias: 'categoria' },
    { table: 'movimientos', column: 'cantidad', agg: 'SUM', alias: 'salidas' },
  ],
  where: { op: 'AND', items: [{ table: 'movimientos', column: 'tipo', op: '=', value: 'SALIDA' }] },
  groupBy: [{ table: 'categorias', column: 'nombre' }],
  orderBy: [{ alias: 'categoria', dir: 'ASC' }],
};

const stockPorCategoria = {
  from: 'stock',
  joins: [{ table: 'productos' }, { table: 'categorias' }],
  select: [
    { table: 'categorias', column: 'nombre', alias: 'categoria' },
    { table: 'stock', column: 'cantidad', agg: 'SUM', alias: 'stock' },
  ],
  groupBy: [{ table: 'categorias', column: 'nombre' }],
  orderBy: [{ alias: 'categoria', dir: 'ASC' }],
};

const kpi = (agg, table, column, alias, extra = {}) => ({
  from: table,
  select: [{ table: column === '*' ? undefined : table, column, agg, alias }],
  ...extra,
});

export async function buildDashboard(adapter, user) {
  const [g1, sal, stk, kStock, kMov, kProd] = await Promise.all([
    runQuery(adapter, user, stockPorAlmacen),
    runQuery(adapter, user, salidasPorCategoria),
    runQuery(adapter, user, stockPorCategoria),
    runQuery(adapter, user, kpi('SUM', 'stock', 'cantidad', 'v')),
    runQuery(adapter, user, kpi('COUNT', 'movimientos', '*', 'v')),
    runQuery(adapter, user, kpi('COUNT', 'productos', '*', 'v')),
  ]);

  // Índice de rotación = unidades despachadas / stock actual (dos agregaciones SQL combinadas)
  const stockMap = new Map(stk.rows.map((r) => [r.categoria, Number(r.stock)]));
  const rotacion = sal.rows.map((r) => ({
    categoria: r.categoria,
    salidas: Number(r.salidas),
    stock: stockMap.get(r.categoria) ?? 0,
    indice: stockMap.get(r.categoria) ? Math.round((Number(r.salidas) / stockMap.get(r.categoria)) * 100) / 100 : 0,
  }));

  return {
    kpis: {
      unidades_en_stock: Number(kStock.rows[0].v ?? 0),
      movimientos: Number(kMov.rows[0].v),
      productos: Number(kProd.rows[0].v),
    },
    stockPorAlmacen: { sql: g1.sql, params: g1.params, rows: g1.rows },
    rotacionPorCategoria: { sql: `${sal.sql}\n-- +\n${stk.sql}`, params: [...sal.params, ...stk.params], rows: rotacion },
  };
}

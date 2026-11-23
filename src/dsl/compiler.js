// Compilador: AST validado -> { sql, params }.
// Reglas de oro:
//   * Los VALORES nunca se concatenan: siempre `?` + arreglo de parámetros.
//   * Los IDENTIFICADORES solo salen de nombres ya resueltos contra la whitelist
//     (catalog.js) y se entrecomillan con dialect.quote(), que re-verifica el patrón.
//   * Los filtros de política (RLS) se inyectan siempre, antes que las condiciones del usuario.
import { IDENT_RE } from './catalog.js';
import { policyFilterFor } from '../security/policies.js';

function makeQuote(dialect) {
  return (name) => {
    if (!IDENT_RE.test(name) && !/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(name)) {
      throw new Error(`Identificador no seguro: ${name}`); // no debería ocurrir tras validar
    }
    return dialect.quote(name);
  };
}

export function compileQuery(q, { dialect, policies = [], ctx = {} }) {
  const quote = makeQuote(dialect);
  const params = [];
  const col = (t, c) => `${quote(t)}.${quote(c)}`;

  const aggExpr = (agg, t, c) => (c === '*' ? `${agg}(*)` : `${agg}(${col(t, c)})`);

  const cond = (c) => {
    const lhs = c.agg ? aggExpr(c.agg, c.table, c.column) : col(c.table, c.column);
    switch (c.op) {
      case 'IS NULL': case 'IS NOT NULL':
        return `${lhs} ${c.op}`;
      case 'BETWEEN':
        params.push(c.values[0], c.values[1]);
        return `${lhs} BETWEEN ? AND ?`;
      case 'IN': case 'NOT IN':
        params.push(...c.values);
        return `${lhs} ${c.op} (${c.values.map(() => '?').join(', ')})`;
      case 'LIKE': case 'NOT LIKE': {
        params.push(c.values[0]);
        const like = dialect.likeOp ?? 'LIKE';
        return `${lhs} ${c.op === 'LIKE' ? '' : 'NOT '}${like} ?`;
      }
      case '!=':
        params.push(c.values[0]);
        return `${lhs} <> ?`;
      default:
        params.push(c.values[0]);
        return `${lhs} ${c.op} ?`;
    }
  };

  const group = (g, top = true) => {
    const parts = g.items.map((it) => (it.items ? group(it, false) : cond(it)));
    const joined = parts.join(` ${g.op} `);
    return top && parts.length === 1 ? joined : `(${joined})`;
  };

  // SELECT
  const selectSql = q.select
    .map((s) => `${s.agg ? aggExpr(s.agg, s.table, s.column) : col(s.table, s.column)} AS ${quote(s.alias)}`)
    .join(', ');

  // FROM + JOINs (ON derivado de la relación FK de la whitelist)
  let fromSql = `FROM ${quote(q.from)}`;
  for (const j of q.joins) {
    const r = j.rel;
    fromSql += `\n${j.type} JOIN ${quote(j.table)} ON ${col(r.from, r.fromCol)} = ${col(r.to, r.toCol)}`;
  }

  // WHERE = políticas obligatorias (RLS) AND filtros del usuario
  const appliedPolicies = [];
  const whereParts = [];
  for (const t of q.tables) {
    const f = policyFilterFor(policies, t, ctx, quote);
    if (f) { whereParts.push(f.sql); params.push(...f.params); appliedPolicies.push(...f.text); }
  }
  if (q.where) whereParts.push(group(q.where));

  const lines = [`SELECT ${selectSql}`, fromSql];
  if (whereParts.length) lines.push(`WHERE ${whereParts.join('\n  AND ')}`);
  if (q.groupBy.length) lines.push(`GROUP BY ${q.groupBy.map((g) => col(g.table, g.column)).join(', ')}`);
  if (q.having) lines.push(`HAVING ${group(q.having)}`);
  if (q.orderBy.length) {
    lines.push(`ORDER BY ${q.orderBy
      .map((o) => `${o.alias ? quote(o.alias) : col(o.table, o.column)} ${o.dir}`).join(', ')}`);
  }
  lines.push('LIMIT ?');
  params.push(q.limit);

  return { sql: lines.join('\n'), params, policies: appliedPolicies };
}

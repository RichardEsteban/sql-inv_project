// Políticas de acceso expresadas en SQL (tabla `politicas_acceso`).
//
// Cada fila = (rol, tabla, predicado, columnas_ocultas).
//   predicado        -> filtro obligatorio (Row-Level Security emulada) que se inyecta
//                       en el WHERE de toda consulta que toque la tabla. Ej:
//                       "{t}.almacen_id = :almacen_id"
//   columnas_ocultas -> column-level security (CSV); la columna sale del catálogo efectivo.
//
// Los predicados se validan con una gramática cerrada y los valores (:ctx y literales)
// se convierten en parámetros `?`: la política tampoco concatena valores.
import { CATALOG, IDENT_RE } from '../dsl/catalog.js';
import { DslError } from '../dsl/errors.js';

const OP = '(?:=|<>|!=|<=|>=|<|>)';
const VAL = "(?::[a-z_][a-z0-9_]*|-?\\d+|'[A-Za-z0-9_ ]{0,30}')";
const ATOM = `\\{t\\}\\.[a-z_][a-z0-9_]*\\s*${OP}\\s*${VAL}`;
const PREDICATE_RE = new RegExp(`^${ATOM}(?:\\s+(?:AND|OR)\\s+${ATOM})*$`);
const TOKEN_RE = new RegExp(
  `\\{t\\}\\.[a-z_][a-z0-9_]*|:[a-z_][a-z0-9_]*|-?\\b\\d+\\b|'[A-Za-z0-9_ ]{0,30}'`, 'g');

export async function loadPolicies(adapter, rol) {
  return adapter.all(
    'SELECT rol, tabla, predicado, columnas_ocultas FROM politicas_acceso WHERE rol = ?',
    [rol],
  );
}

export function hiddenColumns(policies) {
  const hidden = {};
  for (const p of policies) {
    if (!p.columnas_ocultas) continue;
    hidden[p.tabla] ??= new Set();
    for (const c of p.columnas_ocultas.split(',').map((s) => s.trim()).filter(Boolean)) {
      hidden[p.tabla].add(c);
    }
  }
  return hidden;
}

// Catálogo visible para el rol (whitelist efectiva = catálogo − columnas ocultas).
export function effectiveCatalog(policies) {
  const hidden = hiddenColumns(policies);
  const out = {};
  for (const [t, def] of Object.entries(CATALOG)) {
    const cols = {};
    for (const [c, cdef] of Object.entries(def.columns)) {
      if (!hidden[t]?.has(c)) cols[c] = cdef;
    }
    out[t] = { label: def.label, columns: cols };
  }
  return out;
}

// Devuelve { sql, params, text } con los filtros obligatorios para `table`, o null.
export function policyFilterFor(policies, table, ctx, quote) {
  const parts = [];
  const params = [];
  const texts = [];
  for (const p of policies) {
    if (p.tabla !== table || !p.predicado) continue;
    const pred = p.predicado.trim();
    if (!PREDICATE_RE.test(pred)) {
      throw new DslError('POLICY_INVALID', `Política inválida para ${table}`, 500);
    }
    // Las columnas del predicado deben existir en el catálogo.
    for (const m of pred.matchAll(/\{t\}\.([a-z_][a-z0-9_]*)/g)) {
      if (!IDENT_RE.test(m[1]) || !CATALOG[table].columns[m[1]]) {
        throw new DslError('POLICY_INVALID', `Columna inexistente en política: ${table}.${m[1]}`, 500);
      }
    }
    let denied = false;
    const local = [];
    const sql = pred.replace(TOKEN_RE, (tok) => {
      if (tok.startsWith('{t}.')) return `${quote(table)}.${quote(tok.slice(4))}`;
      if (tok.startsWith(':')) {
        const v = ctx[tok.slice(1)];
        if (v === undefined || v === null) { denied = true; return '?'; }
        local.push(v);
        return '?';
      }
      local.push(tok.startsWith("'") ? tok.slice(1, -1) : Number(tok));
      return '?';
    });
    // Contexto sin valor (p. ej. operario sin almacén) => denegar todo.
    if (denied) {
      parts.push('1 = 0');
    } else {
      parts.push(`(${sql})`);
      params.push(...local);
    }
    texts.push(`${table}: ${pred}`);
  }
  if (!parts.length) return null;
  return { sql: parts.join(' AND '), params, text: texts };
}

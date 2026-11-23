// Validador previo (pre-compilación).
//   1. Estructura estricta del AST (tipos, tamaños, claves conocidas).
//   2. Whitelist: tablas, columnas, joins, operadores y agregados permitidos
//      para el rol (catálogo efectivo = catálogo − columnas ocultas por política).
//   3. Heurística anti-inyección sobre TODO texto libre (alias, valores).
//   4. Coerción de valores al tipo de la columna.
// Devuelve un AST normalizado; lanza DslError en el primer problema.
import {
  RELATIONS, OPERATORS, OPS_BY_TYPE, AGGREGATES, HAVING_OPS, ORDER_DIRS, LIMITS, ALIAS_RE, IDENT_RE,
} from './catalog.js';
import { DslError } from './errors.js';

const INJECTION_PATTERNS = [
  [/;/, 'terminador de sentencia ";"'],
  [/--/, 'comentario SQL "--"'],
  [/\/\*|\*\//, 'comentario de bloque'],
  [/\bunion\b[\s\S]*\bselect\b/i, 'UNION SELECT'],
  [/\b(drop|alter|truncate|create)\s+(table|view|index|database|trigger)\b/i, 'DDL'],
  [/\b(insert\s+into|delete\s+from|update\s+\w+\s+set)\b/i, 'DML'],
  [/\b(pragma|attach|detach|load_extension|sqlite_master|information_schema|pg_catalog)\b/i, 'objeto de sistema'],
  [/['"`]\s*(or|and)\s+['"`\d(]/i, 'tautología (OR/AND tras comilla)'],
  [/\b(or|and)\s+\d+\s*=\s*\d+/i, 'tautología (OR 1=1)'],
  [/\\x[0-9a-f]{2}|%27|%3b/i, 'secuencia de escape sospechosa'],
];

export function scanText(text, path) {
  for (const [re, label] of INJECTION_PATTERNS) {
    if (re.test(text)) {
      throw new DslError('INJECTION_SUSPECT', `Entrada rechazada: patrón de inyección detectado (${label})`, 400, path);
    }
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (code, msg, path, status = 400) => { throw new DslError(code, msg, status, path); };

function onlyKeys(obj, allowed, path) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail('UNKNOWN_KEY', `Propiedad no permitida "${k}"`, `${path}.${k}`);
  }
}

function coerce(type, raw, path) {
  switch (type) {
    case 'integer': {
      const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (!Number.isInteger(n)) fail('BAD_VALUE', 'Se esperaba un entero', path);
      return n;
    }
    case 'number': {
      const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof n !== 'number' || !Number.isFinite(n)) fail('BAD_VALUE', 'Se esperaba un número', path);
      return n;
    }
    case 'date': {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(raw)) {
        fail('BAD_VALUE', 'Fecha inválida (use AAAA-MM-DD)', path);
      }
      return raw;
    }
    default: {
      if (typeof raw === 'number') raw = String(raw);
      if (typeof raw !== 'string') fail('BAD_VALUE', 'Se esperaba texto', path);
      if (raw.length > LIMITS.MAX_STRING) fail('BAD_VALUE', 'Texto demasiado largo', path);
      scanText(raw, path);
      return raw;
    }
  }
}

export function validateQuery(input, catalog) {
  if (!isObj(input)) fail('BAD_QUERY', 'La consulta debe ser un objeto', '$');
  onlyKeys(input, ['from', 'joins', 'select', 'where', 'groupBy', 'having', 'orderBy', 'limit'], '$');

  // ---- FROM ---------------------------------------------------------------
  const from = input.from;
  if (typeof from !== 'string' || !IDENT_RE.test(from)) fail('BAD_TABLE', 'Tabla inválida en FROM', 'from');
  if (!Object.hasOwn(catalog, from)) {
    fail('TABLE_NOT_ALLOWED', `Tabla no autorizada: ${from}`, 'from', 403);
  }

  // ---- JOINs (el ON se deriva de RELATIONS; el cliente no lo escribe) -------
  const joins = [];
  const included = [from];
  const joinsIn = input.joins ?? [];
  if (!Array.isArray(joinsIn) || joinsIn.length > LIMITS.MAX_JOINS) fail('BAD_JOINS', 'Joins inválidos o demasiados', 'joins');
  joinsIn.forEach((j, i) => {
    const p = `joins[${i}]`;
    if (!isObj(j)) fail('BAD_JOINS', 'Join inválido', p);
    onlyKeys(j, ['table', 'type'], p);
    if (typeof j.table !== 'string' || !IDENT_RE.test(j.table)) fail('BAD_TABLE', 'Tabla inválida en JOIN', `${p}.table`);
    if (!Object.hasOwn(catalog, j.table)) fail('TABLE_NOT_ALLOWED', `Tabla no autorizada: ${j.table}`, `${p}.table`, 403);
    if (included.includes(j.table)) fail('BAD_JOINS', `La tabla ${j.table} ya está en la consulta`, `${p}.table`);
    const type = (j.type ?? 'INNER').toUpperCase();
    if (!['INNER', 'LEFT'].includes(type)) fail('BAD_JOINS', 'Tipo de JOIN no permitido', `${p}.type`);
    const rel = RELATIONS.find((r) =>
      (r.from === j.table && included.includes(r.to)) || (r.to === j.table && included.includes(r.from)));
    if (!rel) fail('NO_RELATION', `No existe relación para unir ${j.table} con ${included.join(', ')}`, p);
    joins.push({ table: j.table, type, rel });
    included.push(j.table);
  });

  const colDef = (table, column, path) => {
    if (typeof table !== 'string' || typeof column !== 'string') fail('BAD_FIELD', 'Campo inválido', path);
    if (!IDENT_RE.test(table) || !IDENT_RE.test(column)) fail('BAD_FIELD', 'Identificador inválido', path);
    if (!Object.hasOwn(catalog, table)) fail('TABLE_NOT_ALLOWED', `Tabla no autorizada: ${table}`, path, 403);
    if (!included.includes(table)) fail('TABLE_NOT_JOINED', `La tabla ${table} no está en FROM/JOIN`, path);
    if (!Object.hasOwn(catalog[table].columns, column)) {
      fail('COLUMN_NOT_ALLOWED', `Columna no autorizada: ${table}.${column}`, path, 403);
    }
    return catalog[table].columns[column];
  };

  // ---- SELECT -------------------------------------------------------------
  const selIn = input.select;
  if (!Array.isArray(selIn) || selIn.length === 0 || selIn.length > LIMITS.MAX_SELECT) {
    fail('BAD_SELECT', `SELECT requiere entre 1 y ${LIMITS.MAX_SELECT} campos`, 'select');
  }
  const outNames = new Set();
  const select = selIn.map((s, i) => {
    const p = `select[${i}]`;
    if (!isObj(s)) fail('BAD_SELECT', 'Campo de SELECT inválido', p);
    onlyKeys(s, ['table', 'column', 'agg', 'alias'], p);
    const agg = s.agg ? String(s.agg).toUpperCase() : null;
    if (agg && !AGGREGATES.includes(agg)) fail('BAD_AGG', `Agregado no permitido: ${s.agg}`, `${p}.agg`);
    let table = s.table; let column = s.column; let type;
    if (agg === 'COUNT' && column === '*') {
      table = null; type = 'integer';
    } else {
      const def = colDef(table, column, p);
      type = def.type;
      if ((agg === 'SUM' || agg === 'AVG') && !['integer', 'number'].includes(def.type)) {
        fail('BAD_AGG', `${agg} requiere columna numérica`, p);
      }
    }
    let alias = s.alias;
    if (alias !== undefined && alias !== null && alias !== '') {
      if (typeof alias !== 'string' || !ALIAS_RE.test(alias)) fail('BAD_ALIAS', 'Alias inválido (letras, dígitos, _)', `${p}.alias`);
      scanText(alias, `${p}.alias`);
    } else alias = null;
    let out = alias;
    if (!out) {
      out = agg ? `${agg.toLowerCase()}_${column === '*' ? 'total' : column}` : column;
      if (outNames.has(out) && table) out = `${table}_${out}`;
      let n = 2; const base = out;
      while (outNames.has(out)) out = `${base}_${n++}`;
    } else if (outNames.has(out)) fail('BAD_ALIAS', `Alias duplicado: ${out}`, `${p}.alias`);
    outNames.add(out);
    const resType = agg ? (agg === 'MIN' || agg === 'MAX' ? type : (agg === 'AVG' ? 'number' : (agg === 'COUNT' ? 'integer' : type))) : type;
    return { table, column, agg, alias: out, type: resType, srcType: type };
  });

  // ---- GROUP BY -----------------------------------------------------------
  const gbIn = input.groupBy ?? [];
  if (!Array.isArray(gbIn) || gbIn.length > LIMITS.MAX_SELECT) fail('BAD_GROUP', 'GROUP BY inválido', 'groupBy');
  const groupBy = gbIn.map((g, i) => {
    if (!isObj(g)) fail('BAD_GROUP', 'GROUP BY inválido', `groupBy[${i}]`);
    onlyKeys(g, ['table', 'column'], `groupBy[${i}]`);
    colDef(g.table, g.column, `groupBy[${i}]`);
    return { table: g.table, column: g.column };
  });

  const hasAgg = select.some((s) => s.agg);
  if (hasAgg || groupBy.length) {
    for (const s of select) {
      if (s.agg) continue;
      if (!groupBy.some((g) => g.table === s.table && g.column === s.column)) {
        fail('GROUP_MISMATCH', `La columna ${s.table}.${s.column} no es agregada y debe estar en GROUP BY`, 'groupBy');
      }
    }
  }

  // ---- WHERE / HAVING (grupos AND/OR anidados, máx. 2 niveles) --------------
  let condCount = 0;
  const parseGroup = (g, depth, path, isHaving) => {
    if (!isObj(g)) fail('BAD_WHERE', 'Grupo inválido', path);
    onlyKeys(g, ['op', 'items'], path);
    const op = String(g.op ?? 'AND').toUpperCase();
    if (!['AND', 'OR'].includes(op)) fail('BAD_WHERE', 'Operador lógico debe ser AND u OR', `${path}.op`);
    if (!Array.isArray(g.items) || g.items.length === 0) fail('BAD_WHERE', 'Un grupo necesita al menos una condición', `${path}.items`);
    const items = g.items.map((it, i) => {
      const ip = `${path}.items[${i}]`;
      if (!isObj(it)) fail('BAD_WHERE', 'Condición inválida', ip);
      if (Array.isArray(it.items)) {
        if (depth >= LIMITS.MAX_WHERE_DEPTH) fail('TOO_DEEP', `Máximo ${LIMITS.MAX_WHERE_DEPTH} niveles de anidamiento AND/OR`, ip);
        return parseGroup(it, depth + 1, ip, isHaving);
      }
      if (++condCount > LIMITS.MAX_CONDITIONS) fail('TOO_MANY', 'Demasiadas condiciones', ip);
      return isHaving ? parseHavingCond(it, ip) : parseCond(it, ip);
    });
    return { op, items };
  };

  const parseValues = (type, opName, value, path) => {
    const arity = OPERATORS[opName]?.arity ?? 1;
    if (arity === 0) return [];
    if (arity === 2) {
      if (!Array.isArray(value) || value.length !== 2) fail('BAD_VALUE', 'BETWEEN requiere [min, max]', path);
      return value.map((v, i) => coerce(type, v, `${path}[${i}]`));
    }
    if (arity === 'list') {
      if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.MAX_IN_LIST) {
        fail('BAD_VALUE', `IN requiere una lista de 1 a ${LIMITS.MAX_IN_LIST} valores`, path);
      }
      return value.map((v, i) => coerce(type, v, `${path}[${i}]`));
    }
    if (value === undefined || value === null || Array.isArray(value) || isObj(value)) {
      fail('BAD_VALUE', 'Se esperaba un valor escalar', path);
    }
    return [coerce(type, value, path)];
  };

  const parseCond = (c, path) => {
    onlyKeys(c, ['table', 'column', 'op', 'value'], path);
    const def = colDef(c.table, c.column, path);
    const op = String(c.op ?? '').toUpperCase();
    if (!OPS_BY_TYPE[def.type].includes(op)) fail('BAD_OP', `Operador "${c.op}" no permitido para columna ${def.type}`, `${path}.op`);
    return { table: c.table, column: c.column, op, values: parseValues(def.type, op, c.value, `${path}.value`) };
  };

  const parseHavingCond = (c, path) => {
    onlyKeys(c, ['agg', 'table', 'column', 'op', 'value'], path);
    const agg = String(c.agg ?? '').toUpperCase();
    if (!AGGREGATES.includes(agg)) fail('BAD_AGG', 'HAVING requiere un agregado (COUNT, SUM, AVG, MIN, MAX)', `${path}.agg`);
    let type; let table = c.table; let column = c.column;
    if (agg === 'COUNT' && column === '*') { table = null; type = 'integer'; } else {
      const def = colDef(table, column, path);
      if ((agg === 'SUM' || agg === 'AVG') && !['integer', 'number'].includes(def.type)) fail('BAD_AGG', `${agg} requiere columna numérica`, path);
      type = agg === 'MIN' || agg === 'MAX' ? def.type : 'number';
    }
    const op = String(c.op ?? '').toUpperCase();
    if (!HAVING_OPS.includes(op)) fail('BAD_OP', `Operador "${c.op}" no permitido en HAVING`, `${path}.op`);
    return { agg, table, column, op, values: parseValues(type, op, c.value, `${path}.value`) };
  };

  const where = input.where ? parseGroup(input.where, 1, 'where', false) : null;
  const having = input.having ? parseGroup(input.having, 1, 'having', true) : null;
  if (having && !hasAgg && !groupBy.length) fail('BAD_HAVING', 'HAVING requiere GROUP BY o agregados', 'having');

  // ---- ORDER BY ------------------------------------------------------------
  const obIn = input.orderBy ?? [];
  if (!Array.isArray(obIn) || obIn.length > LIMITS.MAX_SELECT) fail('BAD_ORDER', 'ORDER BY inválido', 'orderBy');
  const orderBy = obIn.map((o, i) => {
    const p = `orderBy[${i}]`;
    if (!isObj(o)) fail('BAD_ORDER', 'ORDER BY inválido', p);
    onlyKeys(o, ['alias', 'table', 'column', 'dir'], p);
    const dir = String(o.dir ?? 'ASC').toUpperCase();
    if (!ORDER_DIRS.includes(dir)) fail('BAD_ORDER', 'Dirección debe ser ASC o DESC', `${p}.dir`);
    if (o.alias !== undefined) {
      if (typeof o.alias !== 'string' || !outNames.has(o.alias)) fail('BAD_ORDER', `Alias inexistente en SELECT: ${o.alias}`, `${p}.alias`);
      return { alias: o.alias, dir };
    }
    colDef(o.table, o.column, p);
    if (hasAgg || groupBy.length) {
      const ok = groupBy.some((g) => g.table === o.table && g.column === o.column);
      if (!ok) fail('GROUP_MISMATCH', 'ORDER BY de columna no agregada debe estar en GROUP BY', p);
    }
    return { table: o.table, column: o.column, dir };
  });

  // ---- LIMIT ----------------------------------------------------------------
  let limit = input.limit ?? LIMITS.DEFAULT_ROWS;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.MAX_ROWS) {
    fail('BAD_LIMIT', `LIMIT debe ser un entero entre 1 y ${LIMITS.MAX_ROWS}`, 'limit');
  }

  return { from, joins, select, where, groupBy, having, orderBy, limit, tables: included };
}

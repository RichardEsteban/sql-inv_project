// Frontend sin build. Todo el texto se inserta con textContent (sin innerHTML) → sin XSS.
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};

let token = sessionStorage.getItem('token');
let me = null;
let schema = null;
const charts = {};

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/auth/login') { logout(); throw new Error('Sesión expirada'); }
  if (!res.ok) { const e = new Error(data.error?.message ?? res.statusText); e.code = data.error?.code; e.status = res.status; throw e; }
  return data;
}

// ───────────────────────── sesión ─────────────────────────
function logout() { token = null; sessionStorage.removeItem('token'); location.reload(); }
$('#logout').addEventListener('click', logout);
for (const b of document.querySelectorAll('.chip[data-u]')) {
  b.addEventListener('click', () => { $('#lg-user').value = b.dataset.u; $('#lg-pass').value = b.dataset.p; });
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('POST', '/api/auth/login', { username: $('#lg-user').value, password: $('#lg-pass').value });
    token = r.token; sessionStorage.setItem('token', token); await boot();
  } catch (err) { const p = $('#lg-error'); p.textContent = err.message; p.classList.remove('hidden'); }
});

async function boot() {
  if (!token) { $('#login').classList.remove('hidden'); return; }
  try {
    const m = await api('GET', '/api/me');
    me = m.user; schema = await api('GET', '/api/schema');
    $('#engine').textContent = `motor: ${m.engine}`;
    $('#who').textContent = `${me.username} · ${me.rol}${me.almacen_id ? ` (almacén ${me.almacen_id})` : ''}`;
  } catch { token = null; $('#login').classList.remove('hidden'); return; }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#tab-audit').classList.toggle('hidden', me.rol !== 'admin');
  $('#mv-alm-wrap').classList.toggle('hidden', me.rol !== 'admin');
  initBuilder(); initSecurity(); showTab('builder');
}

// ───────────────────────── pestañas ─────────────────────────
function showTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const p of document.querySelectorAll('.tabpane')) p.classList.add('hidden');
  $(name === 'audit' ? '#tab-audit-pane' : `#tab-${name}`).classList.remove('hidden');
  if (name === 'dashboard') loadDashboard();
  if (name === 'audit') loadAudit();
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));

// ───────────────────────── constructor visual ─────────────────────────
// Estado = AST del DSL (lo único que viaja al servidor).
const state = { from: '', joins: [], select: [], where: { op: 'AND', items: [] }, groupAuto: true, groupManual: [], having: [], orderBy: [], limit: 50 };
const tableCols = (t) => Object.entries(schema.tables[t]?.columns ?? {});
const fieldKey = (t, c) => `${t}.${c}`;
const parseKey = (k) => { const [table, column] = k.split('.'); return { table, column }; };
const fieldType = (t, c) => schema.tables[t]?.columns[c]?.type ?? 'text';
const includedTables = () => [state.from, ...state.joins];

function fieldOptions(selected, { allowStar = false } = {}) {
  const opts = [];
  if (allowStar) opts.push(el('option', { value: '*.*', selected: selected === '*.*' }, '* (todas las filas)'));
  for (const t of includedTables()) {
    for (const [c, def] of tableCols(t)) {
      const k = fieldKey(t, c);
      opts.push(el('option', { value: k, selected: k === selected }, `${t}.${c} · ${def.type}`));
    }
  }
  return opts;
}

function initBuilder() {
  const from = $('#from'); from.replaceChildren(...Object.keys(schema.tables).map((t) => el('option', { value: t }, schema.tables[t].label)));
  state.from = from.value; state.joins = []; state.select = []; state.where = { op: 'AND', items: [] };
  state.having = []; state.orderBy = []; state.groupManual = [];
  const first = tableCols(state.from)[0];
  state.select.push({ key: fieldKey(state.from, first[0]), agg: '', alias: '' });
  $('#limit').value = 50; state.limit = 50;
  renderAll();
}

$('#from').addEventListener('change', (e) => {
  state.from = e.target.value; state.joins = []; state.where = { op: 'AND', items: [] };
  state.having = []; state.orderBy = []; state.groupManual = [];
  const first = tableCols(state.from)[0];
  state.select = [{ key: fieldKey(state.from, first[0]), agg: '', alias: '' }];
  renderAll();
});
$('#group-auto').addEventListener('change', (e) => { state.groupAuto = e.target.checked; renderAll(); });
$('#group-manual').addEventListener('change', (e) => { state.groupManual = [...e.target.selectedOptions].map((o) => o.value); schedule(); });
$('#limit').addEventListener('input', (e) => { state.limit = Number(e.target.value); schedule(); });
$('#add-select').addEventListener('click', () => { state.select.push({ key: fieldKey(state.from, tableCols(state.from)[0][0]), agg: '', alias: '' }); renderAll(); });
$('#add-having').addEventListener('click', () => { state.having.push({ agg: 'SUM', key: '*.*', op: '>', value: '' }); renderAll(); });
$('#add-order').addEventListener('click', () => { const o = outputs(); if (o.length) { state.orderBy.push({ alias: o[0], dir: 'ASC' }); renderAll(); } });

// Tablas alcanzables por FK desde las ya incluidas
function joinable() {
  const inc = new Set(includedTables());
  return Object.keys(schema.tables).filter((t) => !inc.has(t) && schema.relations.some((r) => (r.from === t && inc.has(r.to)) || (r.to === t && inc.has(r.from))));
}
function renderJoins() {
  const box = $('#joins'); box.replaceChildren();
  const all = Object.keys(schema.tables).filter((t) => t !== state.from);
  const reachable = new Set([...joinable(), ...state.joins]);
  for (const t of all) {
    const chk = el('input', { type: 'checkbox', checked: state.joins.includes(t), disabled: !reachable.has(t) });
    chk.addEventListener('change', () => {
      if (chk.checked) state.joins.push(t);
      else dropTable(t);
      renderAll();
    });
    box.append(el('label', {}, chk, `JOIN ${t}`));
  }
}
function dropTable(t) {
  // quita la tabla y todo lo que dependa de ella
  state.joins = state.joins.filter((x) => x !== t);
  const inc = new Set(includedTables());
  // si alguna tabla restante dejó de ser alcanzable, también se quita
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of [...state.joins]) {
      const others = new Set([state.from, ...state.joins.filter((x) => x !== j)]);
      if (!schema.relations.some((r) => (r.from === j && others.has(r.to)) || (r.to === j && others.has(r.from)))) { state.joins = state.joins.filter((x) => x !== j); changed = true; }
    }
  }
  const ok = (k) => k === '*.*' || new Set(includedTables()).has(parseKey(k).table);
  state.select = state.select.filter((s) => ok(s.key));
  if (!state.select.length) state.select.push({ key: fieldKey(state.from, tableCols(state.from)[0][0]), agg: '', alias: '' });
  state.having = state.having.filter((h) => ok(h.key));
  state.groupManual = state.groupManual.filter(ok);
  state.orderBy = state.orderBy.filter((o) => !o.key || ok(o.key));
  const prune = (g) => { g.items = g.items.filter((i) => (i.items ? (prune(i), true) : ok(i.key))); return g; };
  prune(state.where);
  void inc;
}

// nombres de salida (misma regla que el validador del servidor)
function outputs() {
  const used = new Set(); const out = [];
  for (const s of state.select) {
    const { table, column } = parseKey(s.key);
    let n = s.alias?.trim() || (s.agg ? `${s.agg.toLowerCase()}_${column === '*' ? 'total' : column}` : column);
    if (!s.alias?.trim()) { if (used.has(n) && table !== '*') n = `${table}_${n}`; const b = n; let i = 2; while (used.has(n)) n = `${b}_${i++}`; }
    used.add(n); out.push(n);
  }
  return out;
}

function renderSelect() {
  const box = $('#select-rows'); box.replaceChildren();
  const outs = outputs();
  state.select.forEach((s, i) => {
    const f = el('select', { class: 'grow', onchange: (e) => { s.key = e.target.value; if (s.key === '*.*') s.agg = 'COUNT'; renderAll(); } }, fieldOptions(s.key, { allowStar: true }));
    const a = el('select', { onchange: (e) => { s.agg = e.target.value; renderAll(); } },
      ['', ...schema.aggregates].map((x) => el('option', { value: x, selected: x === s.agg }, x || '— sin agregado')));
    const al = el('input', { placeholder: outs[i], value: s.alias, oninput: (e) => { s.alias = e.target.value; schedule(); } });
    al.addEventListener('change', renderAll);
    const del = el('button', { class: 'btn small danger', title: 'Quitar', onclick: () => { state.select.splice(i, 1); renderAll(); } }, '✕');
    box.append(el('div', { class: 'row' }, f, a, al, del));
  });
}

function condRow(c, onDelete) {
  const { table, column } = parseKey(c.key);
  const type = fieldType(table, column);
  const ops = schema.opsByType[type] ?? [];
  if (!ops.includes(c.op)) c.op = ops[0];
  const f = el('select', { class: 'grow', onchange: (e) => { c.key = e.target.value; renderAll(); } }, fieldOptions(c.key));
  const o = el('select', { onchange: (e) => { c.op = e.target.value; renderAll(); } }, ops.map((x) => el('option', { value: x, selected: x === c.op }, x)));
  const row = el('div', { class: 'row' }, f, o);
  if (c.op === 'BETWEEN') {
    c.value = Array.isArray(c.value) ? c.value : ['', ''];
    row.append(el('input', { value: c.value[0], placeholder: 'mín', oninput: (e) => { c.value[0] = e.target.value; schedule(); } }),
      el('input', { value: c.value[1], placeholder: 'máx', oninput: (e) => { c.value[1] = e.target.value; schedule(); } }));
  } else if (c.op === 'IS NULL' || c.op === 'IS NOT NULL') {
    c.value = '';
  } else {
    const isList = c.op.endsWith('IN');
    if (isList && !Array.isArray(c.value)) c.value = [];
    if (!isList && typeof c.value !== 'string') c.value = '';
    row.append(el('input', { value: isList ? c.value.join(', ') : c.value, placeholder: isList ? 'a, b, c' : (type === 'date' ? 'AAAA-MM-DD' : 'valor'),
      oninput: (e) => { c.value = isList ? e.target.value.split(',').map((x) => x.trim()).filter(Boolean) : e.target.value; schedule(); } }));
  }
  row.append(el('button', { class: 'btn small danger', onclick: onDelete }, '✕'));
  return row;
}

function groupView(g, depth, onDelete) {
  const box = el('div', { class: 'group' });
  const op = el('select', { onchange: (e) => { g.op = e.target.value; schedule(); } }, ['AND', 'OR'].map((x) => el('option', { value: x, selected: x === g.op }, x)));
  const head = el('div', { class: 'row' }, el('strong', {}, depth === 1 ? 'Grupo raíz' : 'Subgrupo'), op,
    el('button', { class: 'btn small', onclick: () => { g.items.push({ key: fieldKey(state.from, tableCols(state.from)[0][0]), op: '=', value: '' }); renderAll(); } }, '+ condición'));
  if (depth < schema.limits.MAX_WHERE_DEPTH) head.append(el('button', { class: 'btn small', onclick: () => { g.items.push({ op: 'OR', items: [] }); renderAll(); } }, '+ subgrupo'));
  if (onDelete) head.append(el('button', { class: 'btn small danger', onclick: onDelete }, 'Quitar grupo'));
  box.append(head);
  g.items.forEach((it, i) => {
    box.append(it.items ? groupView(it, depth + 1, () => { g.items.splice(i, 1); renderAll(); }) : condRow(it, () => { g.items.splice(i, 1); renderAll(); }));
  });
  return box;
}
const renderWhere = () => $('#where').replaceChildren(groupView(state.where, 1, null));

function renderHaving() {
  const box = $('#having-rows'); box.replaceChildren();
  state.having.forEach((h, i) => {
    const agg = el('select', { onchange: (e) => { h.agg = e.target.value; schedule(); } }, schema.aggregates.map((x) => el('option', { value: x, selected: x === h.agg }, x)));
    const f = el('select', { class: 'grow', onchange: (e) => { h.key = e.target.value; schedule(); } }, fieldOptions(h.key, { allowStar: true }));
    const o = el('select', { onchange: (e) => { h.op = e.target.value; renderAll(); } }, ['=', '!=', '<', '<=', '>', '>=', 'BETWEEN'].map((x) => el('option', { value: x, selected: x === h.op }, x)));
    const row = el('div', { class: 'row' }, agg, f, o);
    if (h.op === 'BETWEEN') {
      h.value = Array.isArray(h.value) ? h.value : ['', ''];
      row.append(el('input', { value: h.value[0], oninput: (e) => { h.value[0] = e.target.value; schedule(); } }), el('input', { value: h.value[1], oninput: (e) => { h.value[1] = e.target.value; schedule(); } }));
    } else {
      if (typeof h.value !== 'string') h.value = '';
      row.append(el('input', { value: h.value, placeholder: 'valor', oninput: (e) => { h.value = e.target.value; schedule(); } }));
    }
    row.append(el('button', { class: 'btn small danger', onclick: () => { state.having.splice(i, 1); renderAll(); } }, '✕'));
    box.append(row);
  });
}

function renderOrder() {
  const box = $('#order-rows'); box.replaceChildren();
  const outs = outputs();
  state.orderBy.forEach((o, i) => {
    if (o.alias && !outs.includes(o.alias)) o.alias = outs[0];
    const a = el('select', { class: 'grow', onchange: (e) => { o.alias = e.target.value; schedule(); } }, outs.map((x) => el('option', { value: x, selected: x === o.alias }, x)));
    const d = el('select', { onchange: (e) => { o.dir = e.target.value; schedule(); } }, ['ASC', 'DESC'].map((x) => el('option', { value: x, selected: x === o.dir }, x)));
    box.append(el('div', { class: 'row' }, a, d, el('button', { class: 'btn small danger', onclick: () => { state.orderBy.splice(i, 1); renderAll(); } }, '✕')));
  });
}

function renderGroupManual() {
  $('#group-manual-wrap').classList.toggle('hidden', state.groupAuto);
  const sel = $('#group-manual'); sel.replaceChildren(...fieldOptions(null).map((o) => { o.selected = state.groupManual.includes(o.value); return o; }));
}

function renderAll() {
  renderJoins(); renderSelect(); renderWhere(); renderHaving(); renderOrder(); renderGroupManual(); schedule();
}

// estado → AST del DSL
function toAst() {
  const outs = outputs();
  const select = state.select.map((s, i) => {
    const { table, column } = parseKey(s.key);
    const item = { column, alias: outs[i] };
    if (table !== '*') item.table = table;
    if (s.agg) item.agg = s.agg;
    return item;
  });
  const grp = (g) => ({ op: g.op, items: g.items.map((it) => {
    if (it.items) return grp(it);
    const { table, column } = parseKey(it.key); return { table, column, op: it.op, value: it.value };
  }) });
  const pruneEmpty = (g) => ({ op: g.op, items: g.items.filter((i) => !i.items || i.items.length).map((i) => (i.items ? pruneEmpty(i) : i)) });
  const where = pruneEmpty(grp(state.where));
  const ast = { from: state.from, select, limit: state.limit || 50 };
  if (state.joins.length) ast.joins = state.joins.map((t) => ({ table: t }));
  if (where.items.length) ast.where = where;
  const groupCols = state.groupAuto
    ? state.select.filter((s) => !s.agg).map((s) => s.key)
    : state.groupManual;
  const hasAgg = state.select.some((s) => s.agg) || state.having.length;
  if (groupCols.length && (hasAgg || !state.groupAuto)) ast.groupBy = groupCols.map(parseKey);
  if (state.having.length) {
    ast.having = { op: 'AND', items: state.having.map((h) => {
      const { table, column } = parseKey(h.key);
      const it = { agg: h.agg, column, op: h.op, value: h.value };
      if (table !== '*') it.table = table;
      return it;
    }) };
  }
  if (state.orderBy.length) ast.orderBy = state.orderBy.map((o) => ({ alias: o.alias, dir: o.dir }));
  return ast;
}

let timer;
function schedule() { clearTimeout(timer); timer = setTimeout(compile, 250); }
async function compile() {
  const err = $('#compile-error');
  try {
    const r = await api('POST', '/api/query/compile', toAst());
    $('#sql').textContent = r.sql; $('#params').textContent = JSON.stringify(r.params);
    $('#policies-applied').textContent = r.policies.length ? `🔒 Filtros de política inyectados: ${r.policies.join(' · ')}` : '';
    err.classList.add('hidden'); $('#run').disabled = false;
  } catch (e) {
    err.textContent = `${e.code ? `[${e.code}] ` : ''}${e.message}`; err.classList.remove('hidden'); $('#run').disabled = true;
  }
}

let lastResult = null;
$('#run').addEventListener('click', async () => {
  const info = $('#run-info');
  try {
    info.textContent = 'ejecutando…';
    const r = await api('POST', '/api/query/run', toAst());
    lastResult = r; info.textContent = `${r.rowCount} filas · ${r.ms} ms`;
    renderTable($('#result-table'), r.columns.map((c) => c.name), r.rows, r.columns.map((c) => c.type));
    setupChart(r);
  } catch (e) { info.textContent = ''; const err = $('#compile-error'); err.textContent = `[${e.code}] ${e.message}`; err.classList.remove('hidden'); }
});

function renderTable(table, cols, rows, types = []) {
  const thead = el('thead', {}, el('tr', {}, cols.map((c) => el('th', {}, c))));
  const tbody = el('tbody', {}, rows.map((r) => el('tr', {}, cols.map((c, i) => {
    const v = r[c]; const num = typeof v === 'number';
    return el('td', { class: num || ['integer', 'number'].includes(types[i]) ? 'num' : '' }, v === null ? 'NULL' : (num && !Number.isInteger(v) ? v.toLocaleString('es-PE', { maximumFractionDigits: 2 }) : v));
  }))));
  table.replaceChildren(thead, tbody);
}

// ───────────────────────── gráficos ─────────────────────────
const PALETTE = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'];
function drawChart(key, canvas, type, labels, datasets, opts = {}) {
  charts[key]?.destroy();
  Chart.defaults.color = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#667085';
  Chart.defaults.borderColor = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#dfe3ea';
  const pie = type === 'pie';
  const styled = datasets.map((d, i) => ({ ...d, backgroundColor: pie ? labels.map((_, j) => PALETTE[j % PALETTE.length]) : PALETTE[i % PALETTE.length], borderColor: PALETTE[i % PALETTE.length], borderWidth: type === 'line' ? 2 : 0 }));
  charts[key] = new Chart(canvas, { type, data: { labels, datasets: styled },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: pie || datasets.length > 1 }, ...opts.plugins }, scales: pie ? {} : { y: { beginAtZero: true } } } });
}

function setupChart(r) {
  const nums = r.columns.filter((c) => ['integer', 'number'].includes(c.type)).map((c) => c.name);
  const labs = r.columns.map((c) => c.name);
  const L = $('#chart-label'); const V = $('#chart-value');
  L.replaceChildren(...labs.map((n) => el('option', { value: n }, n)));
  V.replaceChildren(...nums.map((n) => el('option', { value: n }, n)));
  const textCol = r.columns.find((c) => !['integer', 'number'].includes(c.type));
  if (textCol) L.value = textCol.name;
  if (nums.length > 1 && L.value === nums[0]) V.value = nums[nums.length - 1]; else if (nums.length) V.value = nums[nums.length - 1];
  redrawResultChart();
}
function redrawResultChart() {
  if (!lastResult || !$('#chart-value').value) { charts.res?.destroy(); return; }
  const lab = $('#chart-label').value; const val = $('#chart-value').value;
  const rows = lastResult.rows.slice(0, 40);
  drawChart('res', $('#result-chart'), $('#chart-type').value, rows.map((r) => String(r[lab])), [{ label: val, data: rows.map((r) => Number(r[val])) }]);
}
for (const id of ['#chart-type', '#chart-label', '#chart-value']) $(id).addEventListener('change', redrawResultChart);

// ───────────────────────── dashboard ─────────────────────────
async function loadDashboard() {
  const d = await api('GET', '/api/dashboard');
  const fmt = (n) => Number(n).toLocaleString('es-PE');
  $('#k-stock').textContent = fmt(d.kpis.unidades_en_stock); $('#k-mov').textContent = fmt(d.kpis.movimientos); $('#k-prod').textContent = fmt(d.kpis.productos);
  drawChart('stock', $('#ch-stock'), 'bar', d.stockPorAlmacen.rows.map((r) => r.almacen), [{ label: 'Unidades en stock', data: d.stockPorAlmacen.rows.map((r) => Number(r.unidades)) }]);
  const rot = d.rotacionPorCategoria.rows;
  drawChart('rot', $('#ch-rot'), 'bar', rot.map((r) => r.categoria), [{ label: 'Índice de rotación', data: rot.map((r) => r.indice) }], {
    plugins: { tooltip: { callbacks: { afterLabel: (c) => `salidas: ${fmt(rot[c.dataIndex].salidas)} · stock: ${fmt(rot[c.dataIndex].stock)}` } } } });
  $('#sql-stock').textContent = d.stockPorAlmacen.sql; $('#sql-rot').textContent = d.rotacionPorCategoria.sql;
}

// ───────────────────────── seguridad y operación ─────────────────────────
const ATTACKS = [
  ['Inyección en un valor (OR 1=1)', { from: 'productos', select: [{ table: 'productos', column: 'id' }], where: { op: 'AND', items: [{ table: 'productos', column: 'nombre', op: '=', value: "' OR 1=1 --" }] } }],
  ['DROP TABLE en el nombre de tabla', { from: 'productos; DROP TABLE productos', select: [{ table: 'productos', column: 'id' }] }],
  ['Tabla no autorizada: usuarios', { from: 'usuarios', select: [{ table: 'usuarios', column: 'password_hash' }] }],
  ['Tabla de sistema: sqlite_master', { from: 'sqlite_master', select: [{ table: 'sqlite_master', column: 'sql' }] }],
  ['Columna restringida: costo_unitario', { from: 'productos', select: [{ table: 'productos', column: 'costo_unitario' }] }],
  ['UNION SELECT en alias', { from: 'productos', select: [{ table: 'productos', column: 'id', alias: 'x UNION SELECT 1' }] }],
  ['Anidamiento de 3 niveles', { from: 'stock', select: [{ table: 'stock', column: 'id' }], where: { op: 'AND', items: [{ op: 'OR', items: [{ op: 'AND', items: [{ table: 'stock', column: 'id', op: '=', value: 1 }] }] }] } }],
  ['Evadir RLS pidiendo el almacén 2 con OR', { from: 'stock', select: [{ table: 'stock', column: 'almacen_id' }], limit: 5, where: { op: 'OR', items: [{ table: 'stock', column: 'almacen_id', op: '=', value: 2 }, { table: 'stock', column: 'almacen_id', op: '=', value: 3 }] } }],
];
function initSecurity() {
  const box = $('#attacks'); box.replaceChildren();
  for (const [label, ast] of ATTACKS) {
    box.append(el('button', { class: 'btn', onclick: async () => {
      const out = $('#attack-out');
      try {
        const r = await api('POST', '/api/query/run', ast);
        out.textContent = `HTTP 200 · ${r.rowCount} filas\n${r.sql}\nparams=${JSON.stringify(r.params)}\n${r.policies.length ? `Políticas: ${r.policies.join(' · ')}` : ''}`;
      } catch (e) { out.textContent = `HTTP ${e.status} · ${e.code}\n${e.message}`; }
    } }, label));
  }
  const ul = $('#policy-list'); ul.replaceChildren();
  if (!schema.policies.length) ul.append(el('li', {}, 'Sin restricciones (rol admin).'));
  for (const p of schema.policies) ul.append(el('li', {}, el('code', {}, p.tabla), p.predicado ? ` · filtro: ${p.predicado}` : '', p.columnas_ocultas ? ` · ocultas: ${p.columnas_ocultas}` : ''));
}
$('#mov-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#mv-out');
  const body = { producto_id: Number($('#mv-prod').value), tipo: $('#mv-tipo').value, cantidad: Number($('#mv-cant').value) };
  if (me.rol === 'admin') body.almacen_id = Number($('#mv-alm').value);
  try { const r = await api('POST', '/api/movimientos', body); out.textContent = `✔ Registrado. Stock resultante: ${r.stock_resultante}`; out.className = 'small ok'; }
  catch (err) { out.textContent = `✖ [${err.code}] ${err.message}`; out.className = 'small bad'; }
});

// ───────────────────────── auditoría ─────────────────────────
async function loadAudit() {
  const r = await api('GET', '/api/audit');
  renderTable($('#audit-table'), ['id', 'fecha', 'usuario', 'rol', 'accion', 'ok', 'detalle'], r.rows);
}

boot();

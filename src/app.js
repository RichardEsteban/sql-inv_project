import express from 'express';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPassword, signToken, verifyToken } from './security/auth.js';
import { effectiveCatalog, loadPolicies } from './security/policies.js';
import { RELATIONS, OPS_BY_TYPE, AGGREGATES, LIMITS } from './dsl/catalog.js';
import { buildQuery, runQuery } from './dsl/index.js';
import { DslError } from './dsl/errors.js';
import { buildDashboard } from './dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEXT_ID = (t) => `(SELECT COALESCE(MAX(id), 0) + 1 FROM ${t})`;

export function createApp({ adapter, secret = randomBytes(32).toString('hex') }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });

  const audit = (user, accion, ok, detalle) => adapter.run(
    `INSERT INTO auditoria (id, fecha, usuario, rol, accion, ok, detalle) VALUES (${NEXT_ID('auditoria')}, ?, ?, ?, ?, ?, ?)`,
    [new Date().toISOString(), user.username ?? '-', user.rol ?? '-', accion, ok ? 1 : 0, String(detalle ?? '').slice(0, 500)],
  ).catch(() => {});

  // --- auth -----------------------------------------------------------------
  const attempts = new Map();
  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const key = req.ip;
      const rec = attempts.get(key) ?? { n: 0, t: Date.now() };
      if (Date.now() - rec.t > 60_000) { rec.n = 0; rec.t = Date.now(); }
      if (++rec.n > 20) { attempts.set(key, rec); throw new DslError('RATE_LIMIT', 'Demasiados intentos, espere un minuto', 429); }
      attempts.set(key, rec);
      const { username, password } = req.body ?? {};
      if (typeof username !== 'string' || typeof password !== 'string') throw new DslError('BAD_LOGIN', 'Credenciales requeridas', 400);
      const [u] = await adapter.all('SELECT id, username, password_hash, rol, almacen_id FROM usuarios WHERE username = ?', [username]);
      if (!u || !verifyPassword(password, u.password_hash)) {
        await audit({ username, rol: '-' }, 'login', false, 'credenciales inválidas');
        throw new DslError('BAD_LOGIN', 'Usuario o contraseña incorrectos', 401);
      }
      const user = { id: u.id, username: u.username, rol: u.rol, almacen_id: u.almacen_id };
      await audit(user, 'login', true, '');
      res.json({ token: signToken(user, secret), user });
    } catch (e) { next(e); }
  });

  const auth = (roles) => (req, res, next) => {
    const h = req.get('authorization') ?? '';
    const p = h.startsWith('Bearer ') ? verifyToken(h.slice(7), secret) : null;
    if (!p) return next(new DslError('UNAUTHENTICATED', 'Sesión requerida', 401));
    if (roles && !roles.includes(p.rol)) return next(new DslError('FORBIDDEN', `El rol ${p.rol} no puede realizar esta acción`, 403));
    req.user = { id: p.id, username: p.username, rol: p.rol, almacen_id: p.almacen_id };
    next();
  };

  app.get('/api/health', (req, res) => res.json({ ok: true, engine: adapter.name }));
  app.get('/api/me', auth(), (req, res) => res.json({ user: req.user, engine: adapter.name }));

  // --- esquema efectivo para el rol (alimenta el constructor visual) -------------
  app.get('/api/schema', auth(), async (req, res, next) => {
    try {
      const policies = await loadPolicies(adapter, req.user.rol);
      res.json({
        tables: effectiveCatalog(policies),
        relations: RELATIONS,
        opsByType: OPS_BY_TYPE,
        aggregates: AGGREGATES,
        limits: LIMITS,
        policies: policies.map((p) => ({ tabla: p.tabla, predicado: p.predicado, columnas_ocultas: p.columnas_ocultas })),
      });
    } catch (e) { next(e); }
  });

  // --- compilar / ejecutar ---------------------------------------------------
  app.post('/api/query/compile', auth(), async (req, res, next) => {
    try {
      const b = await buildQuery(adapter, req.user, req.body);
      res.json({ sql: b.sql, params: b.params, policies: b.policies });
    } catch (e) {
      if (e instanceof DslError) await audit(req.user, 'compile', false, `${e.code}: ${e.message}`);
      next(e);
    }
  });

  app.post('/api/query/run', auth(), async (req, res, next) => {
    try {
      const r = await runQuery(adapter, req.user, req.body);
      await audit(req.user, 'query', true, r.sql.replace(/\s+/g, ' '));
      res.json(r);
    } catch (e) {
      if (e instanceof DslError) await audit(req.user, 'query', false, `${e.code}: ${e.message}`);
      next(e);
    }
  });

  app.get('/api/dashboard', auth(), async (req, res, next) => {
    try { res.json(await buildDashboard(adapter, req.user)); } catch (e) { next(e); }
  });

  // --- operación: registrar movimiento (operario en su almacén, admin en cualquiera) ---
  app.post('/api/movimientos', auth(['admin', 'operario']), async (req, res, next) => {
    try {
      const { producto_id, tipo, cantidad } = req.body ?? {};
      const almacen_id = req.user.rol === 'operario' ? req.user.almacen_id : req.body?.almacen_id;
      if (!Number.isInteger(producto_id) || !Number.isInteger(almacen_id) || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100000) {
        throw new DslError('BAD_VALUE', 'producto_id, almacen_id y cantidad deben ser enteros positivos', 400);
      }
      if (!['ENTRADA', 'SALIDA'].includes(tipo)) throw new DslError('BAD_VALUE', 'tipo debe ser ENTRADA o SALIDA', 400);
      const out = await adapter.transaction(async (tx) => {
        const [s] = await tx.all('SELECT cantidad FROM stock WHERE almacen_id = ? AND producto_id = ?', [almacen_id, producto_id]);
        if (!s) throw new DslError('NOT_FOUND', 'El producto no existe en ese almacén', 404);
        if (tipo === 'SALIDA' && s.cantidad < cantidad) throw new DslError('INSUFFICIENT_STOCK', `Stock insuficiente (${s.cantidad})`, 409);
        const delta = tipo === 'ENTRADA' ? cantidad : -cantidad;
        await tx.run('UPDATE stock SET cantidad = cantidad + ? WHERE almacen_id = ? AND producto_id = ?', [delta, almacen_id, producto_id]);
        await tx.run(
          `INSERT INTO movimientos (id, producto_id, almacen_id, tipo, cantidad, fecha, costo_total)
           VALUES (${NEXT_ID('movimientos')}, ?, ?, ?, ?, ?, (SELECT costo_unitario FROM productos WHERE id = ?) * ?)`,
          [producto_id, almacen_id, tipo, cantidad, new Date().toISOString().slice(0, 10), producto_id, cantidad],
        );
        return { stock_resultante: s.cantidad + delta };
      });
      await audit(req.user, 'movimiento', true, `${tipo} ${cantidad} prod=${producto_id} alm=${almacen_id}`);
      res.status(201).json(out);
    } catch (e) {
      if (e instanceof DslError) await audit(req.user, 'movimiento', false, `${e.code}: ${e.message}`);
      next(e);
    }
  });

  app.get('/api/audit', auth(['admin']), async (req, res, next) => {
    try {
      res.json({ rows: await adapter.all('SELECT id, fecha, usuario, rol, accion, ok, detalle FROM auditoria ORDER BY id DESC LIMIT 100') });
    } catch (e) { next(e); }
  });

  // --- estáticos -----------------------------------------------------------------
  app.get('/vendor/chart.js', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // --- errores -------------------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof DslError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, path: err.path } });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'JSON inválido' } });
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
  });

  return app;
}

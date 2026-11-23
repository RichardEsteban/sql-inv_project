import { SqliteAdapter } from '../src/db/adapters/sqlite.js';
import { seedDatabase } from '../src/db/seed.js';
import { createApp } from '../src/app.js';

export async function makeDb() {
  const adapter = new SqliteAdapter({ file: ':memory:' });
  const counts = await seedDatabase(adapter);
  return { adapter, counts };
}

export const USERS = {
  admin: { id: 1, username: 'admin', rol: 'admin', almacen_id: null },
  operario: { id: 2, username: 'operario1', rol: 'operario', almacen_id: 1 },
  consulta: { id: 4, username: 'consulta', rol: 'consulta', almacen_id: null },
};

// Levanta la app en un puerto efímero y devuelve un cliente fetch minimalista.
export async function startApp(adapter) {
  const app = createApp({ adapter, secret: 'test-secret' });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { token, body } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const login = async (username, password) => (await call('POST', '/api/auth/login', { body: { username, password } })).body.token;
  return { call, login, close: () => new Promise((r) => server.close(r)) };
}

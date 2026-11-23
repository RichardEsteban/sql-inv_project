// Punto único de selección de motor. Cambiar de motor = DB_ENGINE=postgres (+ DATABASE_URL).
export async function createAdapter(env = process.env) {
  const engine = (env.DB_ENGINE ?? 'sqlite').toLowerCase();
  if (engine === 'sqlite') {
    const { SqliteAdapter } = await import('./adapters/sqlite.js');
    return new SqliteAdapter({ file: env.SQLITE_FILE ?? './data/inventario.db' });
  }
  if (engine === 'postgres') {
    const { PostgresAdapter } = await import('./adapters/postgres.js');
    return PostgresAdapter.create({ connectionString: env.DATABASE_URL });
  }
  throw new Error(`Motor no soportado: ${engine}`);
}

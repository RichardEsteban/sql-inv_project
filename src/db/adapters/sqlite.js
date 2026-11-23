// Adaptador SQLite (node:sqlite, sin dependencias nativas). Única pieza que
// conoce el motor: el DSL, el validador, las políticas y las rutas no importan nada de aquí.
import { DatabaseSync } from 'node:sqlite';

export class SqliteAdapter {
  name = 'sqlite';
  dialect = {
    quote: (id) => `"${id}"`,
    likeOp: 'LIKE', // en SQLite LIKE ya es case-insensitive para ASCII
  };

  constructor({ file = './data/inventario.db' } = {}) {
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this._lock = Promise.resolve();
  }

  async all(sql, params = []) {
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r) => ({ ...r }));
  }

  async run(sql, params = []) {
    const info = this.db.prepare(sql).run(...params);
    return { changes: Number(info.changes) };
  }

  async exec(script) {
    this.db.exec(script);
  }

  // Serializa transacciones (una sola conexión).
  transaction(fn) {
    const next = this._lock.then(async () => {
      this.db.exec('BEGIN');
      try {
        const out = await fn(this);
        this.db.exec('COMMIT');
        return out;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    });
    this._lock = next.catch(() => {});
    return next;
  }

  async close() {
    this.db.close();
  }
}

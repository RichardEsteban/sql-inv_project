// Adaptador PostgreSQL. Demuestra el criterio de éxito: cambiar de motor = cambiar
// este archivo (y la variable DB_ENGINE). El SQL generado usa `?`; aquí se traduce a $1..$n.
export class PostgresAdapter {
  name = 'postgres';
  dialect = {
    quote: (id) => `"${id}"`,
    likeOp: 'ILIKE', // en PostgreSQL LIKE distingue mayúsculas
  };

  constructor({ pool }) {
    this.pool = pool;
  }

  static async create({ connectionString = process.env.DATABASE_URL } = {}) {
    const { default: pg } = await import('pg');
    return new PostgresAdapter({ pool: new pg.Pool({ connectionString }) });
  }

  static toNumbered(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  async all(sql, params = [], client = this.pool) {
    const res = await client.query(PostgresAdapter.toNumbered(sql), params);
    return res.rows;
  }

  async run(sql, params = [], client = this.pool) {
    const res = await client.query(PostgresAdapter.toNumbered(sql), params);
    return { changes: res.rowCount };
  }

  async exec(script) {
    await this.pool.query(script);
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    const tx = {
      name: this.name,
      dialect: this.dialect,
      all: (s, p) => this.all(s, p, client),
      run: (s, p) => this.run(s, p, client),
    };
    try {
      await client.query('BEGIN');
      const out = await fn(tx);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

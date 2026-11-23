import { mkdirSync, existsSync } from 'node:fs';
import { createAdapter } from './db/index.js';
import { seedDatabase } from './db/seed.js';
import { createApp } from './app.js';

mkdirSync('data', { recursive: true });
const adapter = await createAdapter();

// Auto-sembrado en el primer arranque (sqlite) o si el motor aún no tiene tablas.
let needsSeed = false;
try { await adapter.all('SELECT 1 FROM productos LIMIT 1'); } catch { needsSeed = true; }
if (needsSeed) console.log('[sql-inv] sembrando dataset...', await seedDatabase(adapter));

const port = Number(process.env.PORT ?? 3000);
const secret = process.env.TOKEN_SECRET; // si falta, se genera uno efímero
createApp({ adapter, secret }).listen(port, () => {
  console.log(`[sql-inv] http://localhost:${port}  (motor: ${adapter.name})`);
});

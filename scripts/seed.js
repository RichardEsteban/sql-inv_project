import { mkdirSync } from 'node:fs';
import { createAdapter } from '../src/db/index.js';
import { seedDatabase } from '../src/db/seed.js';

mkdirSync('data', { recursive: true });
const adapter = await createAdapter();
const counts = await seedDatabase(adapter);
console.log(`[seed] motor=${adapter.name}`, counts);
await adapter.close();

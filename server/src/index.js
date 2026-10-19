// Entry point: connect to Postgres, apply migrations, serve the API.
import { postgres, migrate } from './db.js';
import { buildApp } from './app.js';

const { DATABASE_URL, PORT = '3000', LOG_LEVEL = 'info' } = process.env;
if (!DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }

const db = postgres(DATABASE_URL);
// Postgres may still be starting: retry the first connection for a minute.
for (let i = 0; ; i++) {
  try { await db.query('SELECT 1'); break; } catch (e) {
    if (i >= 30) throw e;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await migrate(db);
const app = buildApp(db, { logger: { level: LOG_LEVEL } });
await app.listen({ host: '0.0.0.0', port: +PORT });

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => { await app.close(); await db.end(); process.exit(0); });
}

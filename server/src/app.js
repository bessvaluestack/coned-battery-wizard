// The API as a Fastify app over a database ({ query, tx }), so the same app
// runs on Postgres in production and on an in-memory Postgres in tests.
import Fastify from 'fastify';
import { projectRoutes } from './projects.js';

export const VERSION = '0.1.0';

export function buildApp(db, opts = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 8 * 1024 * 1024, trustProxy: true });
  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, db: 'up', version: VERSION };
  });
  app.register(projectRoutes, { db, prefix: '/api' });
  return app;
}

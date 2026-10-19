// node --test test/  (from server/): the API on an in-memory Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/db.js';
import { buildApp } from '../src/app.js';

// PGlite behind the same { query, tx } the API uses on Postgres.
function pglite() {
  const pg = new PGlite();
  const run = (q) => (text, params) => (params ? q.query(text, params) : q.exec(text).then((r) => r[r.length - 1] || { rows: [] }));
  return { query: run(pg), tx: (fn) => pg.transaction((t) => fn({ query: run(t) })), end: () => pg.close() };
}

let db, app;
before(async () => { db = pglite(); await migrate(db, { info() {} }); app = buildApp(db); await app.ready(); });
after(async () => { await app.close(); await db.end(); });

const file = (id, name, battery = 200) => ({ format: 'coned-battery-wizard/project', version: 1, app: '0.2.0', saved: '2026-10-19T00:00:00Z',
  project: { id, name }, inputs: { project: { id, name }, modality: 'btm', battery: { kw: battery } }, upload: null });
const ID = '0b6a3f0e-8a1c-4d6e-9f31-2c4b5a6d7e8f';
const call = (method, url, body, user = 'nick') => app.inject({ method, url, payload: body, headers: { 'x-auth-user': user } });

test('health answers with the database up', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().db, 'up');
});

test('a project is created, listed, read back, and refused twice', async () => {
  const r = await call('POST', '/api/projects', file(ID, 'Riverside Towers'));
  assert.equal(r.statusCode, 201);
  assert.deepEqual(r.json(), { id: ID, rev: 1 });
  const list = (await call('GET', '/api/projects')).json().projects;
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Riverside Towers');
  assert.equal(list[0].created_by, 'nick');
  const got = (await call('GET', `/api/projects/${ID}`)).json();
  assert.equal(got.rev, 1);
  assert.equal(got.doc.inputs.battery.kw, 200);
  assert.equal((await call('POST', '/api/projects', file(ID, 'Again'))).statusCode, 409);
});

test('each save is a revision; a stale save is refused; old revisions stay readable', async () => {
  const r2 = await call('PUT', `/api/projects/${ID}?baseRev=1`, file(ID, 'Riverside Towers', 300), 'cullen');
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.json().rev, 2);
  const stale = await call('PUT', `/api/projects/${ID}?baseRev=1`, file(ID, 'Riverside Towers', 400));
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().latest, 2);
  const revs = (await call('GET', `/api/projects/${ID}/revisions`)).json().revisions;
  assert.deepEqual(revs.map((r) => [r.rev, r.saved_by]), [[2, 'cullen'], [1, 'nick']]);
  assert.notEqual(revs[0].config, revs[1].config, 'the fingerprint follows the inputs');
  assert.equal((await call('GET', `/api/projects/${ID}/revisions/1`)).json().doc.inputs.battery.kw, 200);
  assert.equal((await call('GET', `/api/projects/${ID}`)).json().doc.inputs.battery.kw, 300);
});

test('bad bodies and unknown projects get clear errors', async () => {
  assert.equal((await call('POST', '/api/projects', { format: 'something else' })).statusCode, 400);
  assert.equal((await call('PUT', `/api/projects/${ID}`, file('1b6a3f0e-8a1c-4d6e-9f31-2c4b5a6d7e8f', 'x'))).statusCode, 400);
  assert.equal((await call('PUT', '/api/projects/1b6a3f0e-8a1c-4d6e-9f31-2c4b5a6d7e8f', file('1b6a3f0e-8a1c-4d6e-9f31-2c4b5a6d7e8f', 'x'))).statusCode, 404);
  assert.equal((await call('GET', '/api/projects/not-a-uuid')).statusCode, 404);
});

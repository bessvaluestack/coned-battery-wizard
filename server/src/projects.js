// /api/projects: shared saved projects with revisions.
//
//   GET  /projects                    every project, most recently saved first
//   POST /projects                    a new project from a project file (revision 1)
//   GET  /projects/:id                the latest revision's project file
//   PUT  /projects/:id?baseRev=n      save a new revision; with baseRev, refused (409)
//                                     if someone saved after revision n
//   GET  /projects/:id/revisions      every revision: when, by whom, fingerprint
//   GET  /projects/:id/revisions/:rev that revision's project file
//
// Who saved comes from the X-Auth-User header the web server sets after its
// login; the API is only reachable through the web server.

export const PROJECT_FORMAT = 'coned-battery-wizard/project';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The same fingerprint as the wizard's js/project.js (FNV-1a over JSON with sorted keys).
export function fingerprint(value) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const text = JSON.stringify(canon(value));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// A project file as the wizard writes it, or a reason it is not one.
export function checkProjectFile(doc) {
  if (!doc || typeof doc !== 'object') return 'The body is not a JSON object.';
  if (doc.format !== PROJECT_FORMAT) return `format must be "${PROJECT_FORMAT}".`;
  if (!Number.isInteger(doc.version) || doc.version < 1) return 'version must be a positive integer.';
  if (!doc.project || !UUID.test(doc.project.id || '')) return 'project.id must be a UUID.';
  if (!doc.inputs || typeof doc.inputs !== 'object') return 'inputs must be an object.';
  return null;
}

const configOf = (doc) => { const { project, ...inputs } = doc.inputs; return fingerprint(inputs); };
const nameOf = (doc) => String(doc.project.name || '').slice(0, 200);

export async function projectRoutes(app, { db }) {
  const user = (req) => String(req.headers['x-auth-user'] || 'anonymous').slice(0, 100);
  const bad = (reply, code, message) => reply.code(code).send({ error: message });

  app.get('/projects', async () => {
    const { rows } = await db.query(`SELECT id, name, created_at, created_by, updated_at, updated_by, latest_rev
      FROM projects ORDER BY updated_at DESC LIMIT 1000`);
    return { projects: rows };
  });

  app.post('/projects', async (req, reply) => {
    const doc = req.body, why = checkProjectFile(doc);
    if (why) return bad(reply, 400, why);
    const id = doc.project.id;
    try {
      await db.tx(async (q) => {
        await q.query('INSERT INTO projects (id, name, created_by, updated_by, latest_rev) VALUES ($1, $2, $3, $3, 1)', [id, nameOf(doc), user(req)]);
        await q.query('INSERT INTO project_revisions (project_id, rev, saved_by, name, config, app_version, doc) VALUES ($1, 1, $2, $3, $4, $5, $6)',
          [id, user(req), nameOf(doc), configOf(doc), doc.app || null, doc]);
      });
    } catch (e) {
      if (e.code === '23505') return bad(reply, 409, 'A project with this ID exists: save a new revision with PUT.');
      throw e;
    }
    return reply.code(201).send({ id, rev: 1 });
  });

  app.get('/projects/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return bad(reply, 404, 'No such project.');
    const { rows } = await db.query(`SELECT r.rev, r.saved_at, r.saved_by, r.doc FROM projects p
      JOIN project_revisions r ON r.project_id = p.id AND r.rev = p.latest_rev WHERE p.id = $1`, [req.params.id]);
    if (!rows.length) return bad(reply, 404, 'No such project.');
    const { doc, ...meta } = rows[0];
    return { ...meta, doc };
  });

  app.put('/projects/:id', async (req, reply) => {
    const doc = req.body, why = checkProjectFile(doc);
    if (why) return bad(reply, 400, why);
    if (doc.project.id !== req.params.id) return bad(reply, 400, 'project.id does not match the URL.');
    const baseRev = req.query.baseRev === undefined ? null : Number(req.query.baseRev);
    const out = await db.tx(async (q) => {
      const cur = await q.query('SELECT latest_rev FROM projects WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!cur.rows.length) return { code: 404 };
      const latest = cur.rows[0].latest_rev;
      if (baseRev !== null && baseRev !== latest) return { code: 409, latest };
      const rev = latest + 1;
      await q.query('INSERT INTO project_revisions (project_id, rev, saved_by, name, config, app_version, doc) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [req.params.id, rev, user(req), nameOf(doc), configOf(doc), doc.app || null, doc]);
      await q.query('UPDATE projects SET name = $2, updated_at = now(), updated_by = $3, latest_rev = $4 WHERE id = $1', [req.params.id, nameOf(doc), user(req), rev]);
      return { code: 200, rev };
    });
    if (out.code === 404) return bad(reply, 404, 'No such project: create it with POST.');
    if (out.code === 409) return reply.code(409).send({ error: `Someone saved revision ${out.latest} after the revision this was based on.`, latest: out.latest });
    return { id: req.params.id, rev: out.rev };
  });

  app.get('/projects/:id/revisions', async (req, reply) => {
    if (!UUID.test(req.params.id)) return bad(reply, 404, 'No such project.');
    const { rows } = await db.query(`SELECT rev, saved_at, saved_by, name, config, app_version FROM project_revisions
      WHERE project_id = $1 ORDER BY rev DESC`, [req.params.id]);
    if (!rows.length) return bad(reply, 404, 'No such project.');
    return { revisions: rows };
  });

  app.get('/projects/:id/revisions/:rev', async (req, reply) => {
    if (!UUID.test(req.params.id)) return bad(reply, 404, 'No such revision.');
    const { rows } = await db.query('SELECT rev, saved_at, saved_by, doc FROM project_revisions WHERE project_id = $1 AND rev = $2', [req.params.id, Number(req.params.rev) || 0]);
    if (!rows.length) return bad(reply, 404, 'No such revision.');
    const { doc, ...meta } = rows[0];
    return { ...meta, doc };
  });
}

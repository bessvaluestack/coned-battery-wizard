// Where projects are kept. This build: project files the user saves and
// opens, inputs only (js/project.js). The hosted build
// (coned-battery-wizard-hosted) replaces this module with one that keeps
// every save on its server as a version, the last run included:
//
//   STORE = { kind: 'server', runs: true,
//             list() -> [{ id, name, updated_at, updated_by, latest_rev, run_at, net }],
//             revisions(id) -> [{ rev, saved_at, saved_by, name, config, run_at, net }],
//             load(id, rev?) -> { rev, saved_at, saved_by, doc },
//             save(doc, { baseRev, author }) -> { rev }  (throws { conflict: { latest } }) }
export const STORE = { kind: 'file', runs: false };

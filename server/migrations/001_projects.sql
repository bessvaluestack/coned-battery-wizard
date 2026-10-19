-- Saved projects. A project keeps every save as a revision, so earlier
-- configurations stay available; the document is the wizard's project
-- file (js/project.js), stored as it was saved.

CREATE TABLE projects (
  id          uuid PRIMARY KEY,
  name        text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  latest_rev  integer     NOT NULL DEFAULT 0
);

CREATE TABLE project_revisions (
  project_id  uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  rev         integer     NOT NULL,
  saved_at    timestamptz NOT NULL DEFAULT now(),
  saved_by    text,
  name        text        NOT NULL DEFAULT '',
  config      text,
  app_version text,
  doc         jsonb       NOT NULL,
  PRIMARY KEY (project_id, rev)
);

CREATE INDEX projects_updated_at ON projects (updated_at DESC);

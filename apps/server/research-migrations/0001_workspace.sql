-- Banco independente do Morph. Não executar nas bases antigas.
CREATE TABLE research_projects (
  id uuid PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE research_investigations (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES research_projects(id),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, project_id)
);
CREATE TABLE research_entries (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES research_investigations(id),
  kind text NOT NULL CHECK (kind IN ('OBSERVATION', 'HYPOTHESIS', 'EVIDENCE')),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, investigation_id)
);
CREATE TABLE research_findings (
  id uuid PRIMARY KEY,
  investigation_id uuid NOT NULL REFERENCES research_investigations(id),
  hypothesis_id uuid NOT NULL UNIQUE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (hypothesis_id, investigation_id) REFERENCES research_entries(id, investigation_id)
);
CREATE TABLE research_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES research_projects(id),
  investigation_id uuid,
  kind text NOT NULL,
  summary text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (investigation_id, project_id) REFERENCES research_investigations(id, project_id)
);
CREATE INDEX research_investigations_project ON research_investigations(project_id);
CREATE INDEX research_entries_investigation ON research_entries(investigation_id);
CREATE INDEX research_events_project ON research_events(project_id, id);

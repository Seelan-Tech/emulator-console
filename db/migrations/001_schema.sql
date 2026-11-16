-- Emulator Console's whole schema (SQLite). Applied once; later changes go in 002_*.sql, 003_*.sql, ...
-- Ids are random v4 UUIDs and timestamps are ISO 8601 UTC strings, both produced by the database.

-- A fixture is an ordered list of API calls that rebuilds emulator state (the emulator is in-memory).
create table fixtures (
  id          text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  name        text not null unique check (length(name) between 1 and 100),
  description text not null default '',
  steps       text not null default '[]' check (json_valid(steps)),
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A target is one emulator endpoint the console operates against.
create table targets (
  id             text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  name           text not null unique check (length(name) between 1 and 80),
  endpoint_url   text not null,
  region         text not null default 'us-east-1',
  tls_servername text,                          -- verify the endpoint's certificate as this name
  ca_pem         text,                          -- private CA for the endpoint (public material)
  auth_mode      text not null check (auth_mode in ('static', 'files')),
  access_key_id  text,
  secret_key_enc text,                          -- AES-256-GCM, see src/lib/crypto.ts
  files_dir      text,                          -- auth_mode = files: directory holding emulator_credentials + ca.pem
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at   text,
  -- emulator restart detection and baseline replay
  baseline_fixture_id     text references fixtures(id) on delete set null, -- replayed to restore state
  auto_replay             integer not null default 0 check (auto_replay in (0, 1)),
  instance_fingerprint    text,                                            -- identifies the running emulator instance
  restarted_at            text,                                            -- when a different instance was last seen
  restart_acknowledged_at text,                                            -- the banner was dismissed
  check ((auth_mode = 'static' and access_key_id is not null and secret_key_enc is not null)
      or (auth_mode = 'files' and files_dir is not null))
);

create table fixture_runs (
  id          text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  fixture_id  text not null references fixtures(id) on delete cascade,
  target_id   text references targets(id) on delete set null,
  status      text not null check (status in ('running', 'succeeded', 'failed')),
  trigger     text not null default 'manual' check (trigger in ('manual', 'restart')),
  results     text not null default '[]' check (json_valid(results)), -- per step: ok, ms, error (outputs are not stored)
  started_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at text
);
create index fixture_runs_fixture_idx on fixture_runs(fixture_id, started_at desc);

-- What was called, when. Inputs are deliberately not stored (they can contain secrets).
create table audit_log (
  id          integer primary key autoincrement,
  target_id   text references targets(id) on delete set null,
  source      text not null check (source in ('console', 'fixture')),
  service     text not null,
  operation   text not null,
  mutating    integer not null check (mutating in (0, 1)),
  ok          integer not null check (ok in (0, 1)),
  duration_ms integer not null,
  error       text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index audit_target_idx on audit_log(target_id, id desc);

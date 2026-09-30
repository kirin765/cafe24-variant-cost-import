-- 0003_execution: 쓰기 실행·재조회·복원 ledger. 배치 쓰기는 기본 비활성이며, 한 품목 검증 후 켠다.

alter table import_jobs
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_file_hash text,
  add column if not exists confirmed_preview_version integer,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz;

comment on column import_jobs.status is 'preview → confirmed → running → completed | partial_failure | needs_review | cancelled';

alter table import_rows
  add column if not exists status text not null default 'pending',
  add column if not exists last_checked_at timestamptz,
  add column if not exists result_message text;

comment on column import_rows.status is 'pending | success | failed | conflict | unknown | unchanged | skipped';
comment on column import_rows.after_price is '목표 공급가. 미리보기 시점에 계산한다.';
comment on column import_rows.before_price is '미리보기 시점의 현재 공급가.';

create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references import_jobs (id) on delete cascade,
  row_id uuid references import_rows (id) on delete cascade,
  kind text not null,
  attempt_no integer not null default 1,
  result text not null,
  error_code text,
  message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table attempts is '실행·재조회·복원 시도 이력. timeout/결과 불명도 그대로 남긴다.';
create index if not exists attempts_job_id_idx on attempts (job_id, started_at);

create table if not exists restore_jobs (
  id uuid primary key default gen_random_uuid(),
  source_job_id uuid not null references import_jobs (id) on delete cascade,
  shop_id uuid not null references shops (id) on delete cascade,
  status text not null default 'preview',
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists restore_jobs_shop_id_idx on restore_jobs (shop_id, created_at desc);

create table if not exists restore_rows (
  id uuid primary key default gen_random_uuid(),
  restore_job_id uuid not null references restore_jobs (id) on delete cascade,
  source_row_id uuid not null references import_rows (id) on delete cascade,
  variant_code text not null,
  product_no text,
  before_price bigint,
  target_price bigint,
  restore_price bigint,
  current_price bigint,
  verdict text not null,
  issues jsonb not null default '[]'::jsonb,
  result text not null default 'pending',
  result_message text
);

comment on table restore_rows is '현재 값이 원작업의 목표값과 같을 때만 복원 제안. 아니면 conflict.';
create index if not exists restore_rows_job_id_idx on restore_rows (restore_job_id);

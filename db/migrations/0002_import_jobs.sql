-- 0002_import_jobs: CSV 미리보기 결과를 저장한다. 모든 조회는 shop_id로 제한한다.
-- 쓰기 실행(worker)·시도 이력·복원은 이후 단계에서 추가한다.

create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  status text not null default 'preview',
  file_name text not null,
  file_format text not null,
  file_hash text not null,
  preview_version integer not null default 1,
  counts jsonb not null default '{}'::jsonb,
  file_issues jsonb not null default '[]'::jsonb,
  blocked boolean not null default false,
  block_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table import_jobs is 'CSV 미리보기/실행 작업. status는 preview에서 시작한다.';

create index if not exists import_jobs_shop_id_idx on import_jobs (shop_id, created_at desc);

create table if not exists import_rows (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references import_jobs (id) on delete cascade,
  line integer not null,
  variant_code text not null,
  product_no text,
  product_name text,
  option_name text,
  before_price bigint,
  after_price bigint,
  verdict text not null,
  issues jsonb not null default '[]'::jsonb
);

comment on table import_rows is '미리보기 시점의 행 판정. before_price는 조회 시점의 현재 공급가.';

create index if not exists import_rows_job_id_idx on import_rows (job_id, line);

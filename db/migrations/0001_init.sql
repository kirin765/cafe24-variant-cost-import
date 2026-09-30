-- 0001_init: 앱 전용 저장소. 토큰은 애플리케이션에서 AES-256-GCM으로 암호화해 저장한다.
-- 모든 접근은 mall_id + shop_no로 식별되는 shop을 기준으로 하고, 쿼리 파라미터의 몰 ID만으로 허용하지 않는다.

create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  mall_id text not null,
  shop_no text not null default '1',
  name text,
  currency text not null default 'KRW',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shops_tenant_mall_shop_key unique (tenant_id, mall_id, shop_no),
  constraint shops_shop_no_format check (shop_no ~ '^[0-9]{1,5}$')
);

comment on column shops.tenant_id is '테넌트 식별자. 사용자 계정 도입 전에는 mall_id를 사용한다.';
comment on column shops.shop_no is 'Cafe24 shop_no. 기본 1.';

create table if not exists shop_credentials (
  shop_id uuid primary key references shops (id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  token_type text not null default 'Bearer',
  scopes text[] not null default '{}',
  user_id text,
  -- Cafe24는 타임존 없는 날짜 문자열을 주므로 파싱 오류를 피하려고 원문을 보관한다.
  access_expires_at text,
  refresh_expires_at text,
  issued_at text,
  updated_at timestamptz not null default now()
);

comment on column shop_credentials.access_token is 'AES-256-GCM 봉투(v1.iv.tag.ciphertext). 원문을 저장하지 않는다.';
comment on column shop_credentials.refresh_token is 'AES-256-GCM 봉투(v1.iv.tag.ciphertext). 회전된 값으로 덮어쓴다.';

create table if not exists sessions (
  id_hash text primary key,
  shop_id uuid not null references shops (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

comment on column sessions.id_hash is '세션 쿠키 값의 SHA-256. 원문은 쿠키에만 있다.';

create index if not exists sessions_shop_id_idx on sessions (shop_id);
create index if not exists sessions_expires_at_idx on sessions (expires_at);

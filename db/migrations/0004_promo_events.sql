-- 0004_promo_events: 고정 리뷰이사 추천 이벤트. 캠페인/출처는 코드와 리포트에 고정하고
-- 브라우저는 eventId·eventName만 보낸다. 완료된 가져오기 작업 화면에서만 기록한다.
create table if not exists promo_events (
  id uuid primary key,
  mall_id text not null,
  shop_no integer not null check (shop_no > 0),
  event_name text not null check (event_name in (
    'reviewisa_promo_view', 'reviewisa_promo_click', 'reviewisa_promo_dismiss'
  )),
  occurred_at timestamptz not null default now()
);

create index if not exists promo_events_tenant_time_idx
  on promo_events (mall_id, shop_no, occurred_at desc);

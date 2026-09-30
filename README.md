# cafe24-variant-cost-import

**공급사 원가표(CSV)를 Cafe24 품목에 매칭하고 변경점을 검토한 뒤 옵션별 공급가만 수정**하는 앱 후보의
로컬 데모입니다. 판매가 예약·재고 수정과는 다른 작업입니다.

`plan.md`의 **A. 2시간 데모**(합성 데이터)가 완료되어 있고, **B. 한 품목 쓰기 검증**의 입구로
Cafe24 OAuth 콜백·토큰 교환·앱 실행(launch) 서명 검증에 이어 **앱 전용 Postgres(Neon) 저장소**를
붙였습니다. OAuth로 받은 토큰은 AES-256-GCM으로 암호화해 저장하고, 서버에서 검증하는 세션 쿠키를
발급한 뒤 `/imports/new` 작업 화면으로 이동합니다. CSV는 자체 형식(`variant_code,supply_price`)과
**Cafe24 상품목록 내보내기 형식**(`상품코드`·`공급가`)을 자동 판별해 읽습니다. 옵션(품목)별 공급가
쓰기와 배치 worker는 아직 없으며, 어느 단계에서도 실제 품목 값을 바꾸지 않습니다.

## 실행

```bash
mise install          # node 26.8.2
npm install
cp .env.example .env.local   # Cafe24 앱 인증정보 입력 (OAuth를 쓸 때만)
npm run db:migrate    # Neon Postgres에 schema_migrations·shops·credentials·sessions 생성
npm run dev           # http://localhost:3000
```

Postgres는 Vercel Neon 통합이 주입하는 `DATABASE_URL`(pooled)·`DATABASE_URL_UNPOOLED`(migration)을
쓴다. 토큰 암호화 키 `TOKEN_ENCRYPTION_KEY`(32바이트 base64)는 직접 만들어 넣는다. 키가 없으면
OAuth 콜백이 저장 단계에서 실패한다. `npm run db:migrate`는 migration에 세션 잠금·DDL을 쓰므로
pooled가 아닌 `DATABASE_URL_UNPOOLED`를 우선 사용한다.

| 경로 | 용도 |
|---|---|
| `/` | 소개·매칭·검증 규칙 |
| `/demo` | 몰·합성 파일(또는 직접 올린 CSV) 선택 → 검증·변경 미리보기·행별 오류·명세 내보내기. **현재 상품목록 파일**을 올리면 그 목록을 실제 매칭 기준으로 사용 |
| `/` + launch 파라미터 | `hmac`·`mall_id`가 있으면 `src/proxy.ts`가 launch 경로로 307 |
| `/api/cafe24/launch` | Cafe24 앱 실행 진입점. `hmac` 검증 후 같은 몰의 유효한 세션이 있으면 `/imports/new`로 303, 없으면 OAuth start로 302 |
| `/api/cafe24/oauth/start` | Cafe24 authorize로 302 (state 서명 쿠키 발급, `?mall_id=` 필요/기본값, `shop_no` 전달) |
| `/api/cafe24/oauth/callback` | state 검증 → 토큰 교환 → 암호화 저장 → 세션 쿠키 발급 → `/imports/new`로 303 |
| `/imports/new` | 연결된 몰·shop_no·scope·만료와 CSV 업로드를 제공하는 읽기 전용 작업 화면. 세션 없음/만료/재인증 필요 시 안내 |
| `/api/imports` | CSV 업로드(POST) → 실제 품목 조회 → 검증·미리보기 저장 → `/imports/[id]/preview`로 303 |
| `/imports/[id]/preview` | 저장한 검토의 전후 공급가·변경/동일/오류 집계·행별 문제. 몰 권한이 있는 작업만 열림 |
| `/imports/[id]` | 실행 상태·행별 성공/실패/충돌/결과 불명, 확정·실행·복원 검토. 쓰기 비활성 시 안내 |
| `/api/imports/[id]/confirm`·`/run` | 사용자 확정(파일 해시·미리보기 버전 연결), 실행(리스·재개) |
| `/imports/[id]/restore` | 복원 검토(현재 값 = 원작업 목표값일 때만 제안)와 별도 확정·실행 |
| `/api/imports/[id]/restore`·`/restore/run` | 복원 검토 생성(현재 값 재조회), 복원 실행 |

## 직접 테스트하기 (로컬, 테스트몰)

전제: 대상 몰의 ‘공급가 관리 방식’이 **품목 단위**여야 한다(`docs/user-guide.md`).

1. `.env.local`에 `CAFE24_API_VERSION=2026-09-01`, `IMPORT_WRITE_ENABLED=true`를 넣는다.
2. 토큰이 만료됐으면 갱신한다(토큰 원문을 출력하지 않는다).
   ```bash
   node --env-file-if-exists=.env.local scripts/token-refresh.mjs
   ```
3. **API만 빠르게 확인** (UI 없이 1건 쓰기·원복):
   ```bash
   node --env-file-if-exists=.env.local scripts/live-probe.mjs         # 읽기 전용 점검
   node --env-file-if-exists=.env.local scripts/live-write-check.mjs   # +100 → 재조회 → 원복
   node --env-file-if-exists=.env.local scripts/live-variant-read.mjs  # 목록/단건 값 비교
   ```
4. **앱 UI로 확인**:
   ```bash
   npm run dev            # http://localhost:3000
   node --env-file-if-exists=.env.local scripts/local-session.mjs   # 세션 쿠키 값 출력
   ```
   출력된 `cafe24_session` 쿠키를 브라우저(localhost)에 넣고 `/imports/new`를 연다.
   `variant_code,supply_price` CSV(예: 이미 값이 있는 품목 1~2행)를 올려
   **검토 만들기 → 확정 → 실행 → 복원 검토 만들기 → 복원 실행** 순서로 진행한다.
   - 품목 현재 값이 `null`이면 미리보기에서 `unknown_before_price` 오류로 확정이 막힌다.
     먼저 그 품목에 값을 한 번 써 두거나 값이 있는 품목을 사용한다.
   - 조회 캐시 때문에 쓰기 직후 값이 잠시 이전 값으로 보일 수 있다(앱이 재시도로 처리).

## 검증

```bash
npm test              # 단위 테스트 (DATABASE_URL이 있으면 DB 통합 테스트 포함)
npm run smoke         # 빌드 결과물을 임시 포트로 띄워 Chromium으로 25개 확인
npm run e2e           # Playwright E2E 38개 (빌드 후 임시 포트에서 실행)
npm run verify        # lint → typecheck → test → build → smoke → e2e
```

`npm run e2e`는 `e2e/`의 Playwright 스펙을 돌린다. 시스템 Chromium을 쓰며, 다른 위치면
`CHROMIUM_PATH`로 지정한다. 이미 배포된 URL을 검사하려면 `E2E_BASE_URL=https://… npm run e2e`.
자세한 기대 결과와 한도 소모 여부는 `QA.md`에 있다.

## 구조

```text
src/features/imports/
  model.ts            CSV 행·품목·미리보기·이슈 타입과 파일 한도
  csv.ts              UTF-8/BOM·인용부호·CRLF parser, 형식 자동 판별, Cafe24 상품목록 adapter, 한도 검사
  validate.ts         금액 파싱·정확 매칭·중복/미매칭 오류·변경 계산·집계
  preview.ts          미리보기 조립, 확정 차단 사유, 검토/변경/JSON 명세 출력
  hash.ts             파일 내용 해시( 미리보기 버전 연결)
  platform-snapshot.ts 업로드한 현재 상품목록(상품코드·공급가)을 매칭용 품목으로 변환(데모)
  store.ts            import_jobs·import_rows·attempts·restore_jobs 저장/조회(shop_id 권한)
  executor.ts         한 행 실행: 재조회→충돌 검사→쓰기→재조회, 오류 분류
  restore.ts          복원 계획(현재 값 = 목표값일 때만 복원)
  runner.ts           실행·복원 오케스트레이션, 리스·재개·429 백오프
  runner-context.ts   세션·환경에서 RunnerContext 구성
src/lib/cafe24/
  gateway.ts          VariantGateway + FixtureVariantGateway + 실제 Cafe24VariantGateway
  variants.ts         품목 API: 상품·품목 조회, 페이지네이션, 옵션·공급가 파싱
  amount.ts           Cafe24 문자열 금액(`"4500.00"`) 정규화
  env.ts              CAFE24_* 환경변수 읽기·검사
  oauth.ts            scope, state 서명/검증, authorize URL, 토큰 교환·refresh
  admin.ts            Admin API 상품 조회(Bearer), 응답 파싱·공급가 정규화
  shop-store.ts       shops·credentials·sessions 저장/조회, DB advisory 잠금 refresh
  store-model.ts      Shop·자격 증명·세션 타입, ReauthRequiredError
  session.ts          세션 토큰 생성·해시·만료 판정
  token-lifecycle.ts  Cafe24 시각 파싱(KST 가정)·access/refresh 만료 분류
  auth.ts             세션 쿠키 읽기, 현재 세션, 몰 일치 검사
src/lib/crypto/
  secret-box.ts       AES-256-GCM 암복호화 봉투(v1.iv.tag.ciphertext)
  key.ts              TOKEN_ENCRYPTION_KEY 읽기·검사
src/lib/db/
  pool.ts             pg Pool 설정(ssl 자동)·전역 재사용·DATABASE_URL 검사
  migrate.ts          schema_migrations 기반 SQL migration 실행기(advisory lock)
  migrate-cli.mts     `npm run db:migrate` 진입점(direct 연결)
src/app/imports/
  connection-prompt.tsx  세션 없음/만료/재인증 안내 공용 화면
  new/page.tsx           작업 화면(몰·shop_no·scope·만료·CSV 업로드·최근 검토)
  [id]/page.tsx          실행 상태·행별 결과·확정/실행/복원 버튼
  [id]/preview/page.tsx  저장한 검토의 읽기 전용 미리보기
  [id]/restore/page.tsx  복원 검토·별도 확정/실행
src/app/api/
  imports/route.ts    CSV 업로드 → 품목 조회 → 미리보기 저장
  imports/[id]/confirm|run/route.ts         확정·실행
  imports/[id]/restore|restore/run/route.ts 복원 검토·실행
  cafe24/launch/route.ts     launch hmac → 세션 재접속 또는 OAuth start
  cafe24/oauth/start/route.ts      CSRF state 쿠키 발급 후 authorize로 리다이렉트
  cafe24/oauth/callback/route.ts   state 검증 → 토큰 교환 → 암호화 저장 → 세션
src/lib/download.ts   브라우저 CSV/JSON 다운로드
src/fixtures/         합성 몰·품목·정상/오류 CSV
db/migrations/        SQL migration(0001 shops/credentials/sessions, 0002 import jobs/rows)
docs/cafe24-api-notes.md  공식 API 근거 기록
docs/user-guide.md        사용자 안내(품목별 공급가 전제: ‘공급가 관리 방식’=품목 단위)
scripts/smoke.mjs     브라우저 스모크
e2e/                  Playwright E2E
```

`src/features/jobs/`·`src/workers/`와 `attempts`·`restore_jobs`(쓰기·재조회·복원·worker)는 이후
C단계에서 추가한다.

## 설계 요약

- **형식 자동 판별**: 헤더가 `variant_code,supply_price`면 단순 형식, `상품코드`·`공급가` 열이 있으면
  Cafe24 상품목록/업로드 기본양식으로 읽는다. 헤더 비교는 공백을 무시해 다운로드본(`상품코드`)과
  업로드 양식(`상품 코드`)을 모두 받는다. `상품코드`를 매칭 키로 쓰고 `자체 상품코드`는 쓰지 않는다
  (현재 실데이터에서 비어 있음). `공급가`가 `4500.00`처럼 소수점 이하가 0이면 정수로 정규화하며,
  `4500.50`처럼 0이 아니면 오류로 남긴다.
- **가져올 수 없는 양식**: 옵션/재고 초기화 양식(A~M)과 재고 정보 업로드 양식(A~R)에는 `공급가` 열이
  없다(재고 정보 양식은 `옵션 추가금액`만 있음). 이 경우 "공급가 열이 없어 가져올 수 없습니다"라는
  파일 오류로 거부한다. 옵션별 공급가는 Cafe24가 엑셀 업로드로 제공하지 않으므로 API·UI 경로가 필요하다.
- **정확 매칭만**: 코드의 플랫폼 값 완전 일치만 사용한다. 상품명·옵션명은 검토 화면의
  참고 정보일 뿐 자동 매칭에 쓰지 않는다. 코드 앞자리 0과 문자열을 보존하고 내부 공백·문자 변형을
  자동 교정하지 않는다.
- **금액 규칙**: 빈 공급가는 0으로 해석하지 않는다. 0원은 명시적 입력으로 허용하되 주의로 표시한다.
  음수·부호·통화 기호·천 단위 구분자·소수·지수·앞뒤 공백은 오류다. 정수는 `BigInt`로 안전 범위를
  검사한 뒤 숫자로 바꾼다.
- **오류 우선 차단**: 파일 안 중복 코드(값이 같아도), 미매칭 코드, 열 개수 불일치, 헤더 불일치가 하나라도
  있으면 전체 확정을 막고 수정 파일을 다시 받는다. 부분 행 선택 실행은 후속 기능이다.
- **행 판정**: 매칭 성공 + 값 유효일 때만 `changed`/`unchanged`로 나눈다. 그 외는 `error`다.
- **미리보기 연결**: 파일 해시로 미리보기 버전을 식별한다. 파일이 바뀌면 해시가 달라져 이전 확정과
  연결되지 않는다.
- **매칭 기준 목록**: 데모는 기본적으로 합성 품목을 쓰지만, **현재 상품목록 파일**(Cafe24 상품목록
  내보내기)을 올리면 그 파일의 `상품코드`·`공급가`로 품목을 만들어 실제 코드와 매칭한다. 이때 상품코드가
  비었거나 공급가를 읽지 못한 행은 건너뛰고 몇 행을 건너뛰었는지 표시한다. 실제 품목 값은 여전히 바뀌지 않는다.
- **안전성**: 원가 데이터는 영업정보다. 일반 로그에 원가·원본 파일·토큰 원문을 출력하지 않고, 공급가
  쓰기는 하지 않으며, 데모 확정 안내에 무쓰기를 명시한다.

## OAuth·저장소·세션

- scope: `mall.read_product`, `mall.write_product`, `mall.read_store`만 요청한다(운영자 권한).
- state: HMAC-SHA256 서명 + 10분 만료, HttpOnly·SameSite=Lax 쿠키와 비교해 CSRF를 막는다.
- `mall_id`는 정규식으로 검증해 authorize/token 호스트가 조작되지 않게 한다.
- **토큰 저장**: `shop_credentials`에 access/refresh token을 AES-256-GCM 봉투(`v1.iv.tag.ciphertext`)로
  저장한다. `TOKEN_ENCRYPTION_KEY`는 32바이트 base64다. 응답·로그에 토큰 원문을 출력하지 않는다.
- **refresh**: `getValidAccessToken`이 트랜잭션 안에서 `pg_advisory_xact_lock`을 잡고 자격 증명을
  `for update`로 읽는다. access token이 유효하면 그대로 반환하고, 만료됐으면 회전된 refresh token까지
  저장한다. 여러 서버 인스턴스가 동시에 refresh해도 DB 잠금으로 1회로 합쳐진다.
- **만료 분류**: Cafe24의 타임존 없는 시각은 KST(UTC+9)로 해석하고, refresh 만료까지 지나면
  `ReauthRequiredError`로 재인증을 요구한다. access 만료 시각을 못 읽으면 401 재시도로 넘긴다(후속).
- **세션**: 콜백에서 랜덤 토큰을 발급해 `HttpOnly` 쿠키로 심고, DB에는 SHA-256 해시만 저장한다.
  `/imports/new`와 이후 API·다운로드는 쿼리의 `mall_id`가 아니라 이 세션으로 몰 권한을 확인한다.
- 앱 실행(launch): 루트로 들어온 `hmac`·`mall_id`를 `src/proxy.ts`가 launch 경로로 넘기고,
  `verifyLaunchHmac`이 원본 쿼리 문자열에서 `hmac`을 뺀 값의 `base64(HMAC-SHA256)`를 클라이언트 시크릿으로
  검증한다. 검증에 쓰는 쿼리는 재조립하지 않고 요청 URL 그대로를 사용한다. 같은 몰의 유효한 세션이
  있으면 재인증 없이 `/imports/new`로 보낸다.
- **연결 확인**: `/imports/new`의 “상품 조회”는 `GET /api/v2/admin/products`로 상품 수만 확인한다.
  실패하면 화면에서 “다시 시도”할 수 있다.

## 품목 조회와 CSV 미리보기 (B 입구)

- 공식 근거는 `docs/cafe24-api-notes.md`에 정리했다. 요약: 품목은 상품 하위 리소스이고, 공급가는
  2026-06-15 배포에서 `GET/PUT /api/v2/admin/products/{product_no}/variants`에 `supply_price`로
  추가됐다. API 버전은 헤더 `X-Cafe24-Api-Version`(최신 `2026-09-01`)으로 보낸다.
- **실제 gateway**: `Cafe24VariantGateway`가 상품 목록(페이지네이션) → 각 상품의 품목 목록 순으로
  조회해 `PlatformVariant`(품목 코드·옵션명·현재 공급가)로 변환한다. 상품 수 상한(`IMPORT_MAX_PRODUCTS`,
  기본 500)을 두고 초과 시 잘림을 표시한다. 몰 전체 품목을 한 번에 주는 엔드포인트는 문서에 없다.
- **CSV → 미리보기**: `/imports/new`에서 `variant_code,supply_price` 파일을 올리면 실제 품목과 매칭해
  검증한 뒤 `import_jobs`·`import_rows`에 저장하고 `/imports/[id]/preview`로 보낸다. 파일 해시가
  미리보기 버전이 된다.
- **상품 단위 vs 품목 단위**: 상품목록 내보내기(`상품코드`·`공급가`)는 `variant_code`가 없어 옵션별
  변경의 근거가 아니다. 실제 흐름에서는 차단하고 필요한 형식을 안내한다. `/demo`의 합성 체험은 그대로 둔다.
- **현재 공급가 없음**: 품목 응답에 `supply_price`가 없으면 0으로 보지 않고 `unknown_before_price`
  오류로 확정을 막는다.
- **읽기 전용**: `/imports/[id]/preview`는 조회·검토만 한다.
- **접근 제한**: 미리보기·작업·복원은 세션의 `shop_id`로만 조회한다. 다른 몰의 검토는 열리지 않는다.

## 쓰기 실행과 복원 (B/C)

- **쓰기 비활성 기본**: `IMPORT_WRITE_ENABLED=true`가 아니면 확정·실행·복원이 모두 막힌다. 테스트몰에서
  한 품목 변경·복원을 수동 검증한 뒤 켠다.
- **행 실행 순서**: 실행 직전 현재 값을 재조회 → 미리보기의 이전 값과 다르면 `conflict`로 쓰지 않음 →
  `supply_price`만 담아 `PUT .../variants/{variant_code}` → 재조회로 반영 확인. 판매가·재고·설정 필드는
  요청에 넣지 않는다.
- **timeout·응답 유실**: 성공으로 단정하지 않고(`unknown`) 재조회로 판단한다. 이미 목표값이면
  `applied_after_timeout`으로 성공 처리하고, 맹목 재시도하지 않는다.
- **429·일시 오류**: 지수 백오프로 재시도하고 최대 시도 후 `unknown`으로 남긴다. 401은 재인증 필요로
  중단, 403은 권한 없음, 404는 삭제된 품목으로 기록한다.
- **확정 연결**: 확정은 파일 해시·미리보기 버전에 묶인다. 파일이 바뀌면 확정되지 않는다.
- **worker·리스·재개**: 실행은 요청 단위로 처리하되 `lease_owner`/`lease_expires_at`로 중복 실행을 막고,
  시간 예산(`IMPORT_RUN_BUDGET_MS`)을 넘기면 남은 행을 `pending`으로 두고 다음 실행에서 이어서 처리한다.
  완료·부분 실패·재검토 상태와 시도 이력(`attempts`)을 남긴다.
- **복원**: 성공 행만 대상으로 현재 값이 원작업 목표값(또는 이미 이전 값)일 때만 제안하고 별도 확정·실행한다.
  현재 값이 다르면 `conflict`로 남기고 자동 복원하지 않는다.
- **안전 한계**: 플랫폼에 조건부 쓰기가 없어 재조회와 쓰기 사이 외부 변경 경쟁은 완전히 제거할 수 없다.
  파일럿 동안 동시 원가 편집을 피하고, 배치 전체가 원자적이라 약속하지 않는다.

## 다음 단계

- [완료] 테스트몰에서 한 품목 실제 쓰기·재조회·복원 검증(2026-09-21, `docs/cafe24-api-notes.md`). 단, 이는 몰의 ‘공급가 관리 방식’을 ‘품목 단위’로 전환한 뒤에 가능하다(`docs/user-guide.md`). 공급가 외 필드 유지 육안 대조는 남음.
- `supply_price` 요청 본문·최대값·음수 허용 범위를 실제 호출로 확정.
- 상품 5,000개 초과 `sin_product_no` 경로, 결과 파일 다운로드, 보관기간·삭제 정책.
- 큐/스케줄 기반 상시 worker(현재는 요청 단위 실행 + 재개).

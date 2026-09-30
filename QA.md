# QA — 옵션별 공급가 CSV 가져오기 (로컬 데모)

`plan.md` **A. 2시간 데모**, **B. 한 품목 쓰기 검증**, **C. 작은 배치(2행) 앱 파일럿**까지 검증하는 표다.

- 작성일: 2026-09-17 (2026-09-21 쓰기·복원·파일럿 실측 반영)
- 범위: CSV 파싱·검증·정확 매칭·변경 미리보기·행별 오류·확정 차단·명세 내보내기(A),
  OAuth 콜백·토큰 암호화 저장·세션·`/imports/new`·`/imports/[id]/preview`·몰 격리,
  실제 품목(변형) 조회 gateway·상품목록 형식 차단(B 입구), 품목 공급가 쓰기·재조회·복원(C 파일럿)
- 설치·API 한도: 데모(A)는 **소모 없음**. 실제 OAuth와 품목 조회(`/api/imports`)는 테스트몰에서
  Admin API·설치 한도를 소모한다. 공급가 쓰기는 `IMPORT_WRITE_ENABLED=true`일 때만 실행된다.
- 2026-09-21 실측: onnurimun의 ‘공급가 관리 방식’을 ‘품목 단위’로 전환한 뒤 품목 공급가 PUT·복원이
  성공했다(전환 전에는 `422 Supply price by item cannot be modified.`). 근거는 `docs/cafe24-api-notes.md`,
  사용자 안내는 `docs/user-guide.md`.

## 실행

```bash
mise install          # node 26.8.2
npm install
npm run dev           # http://localhost:3000
```

## 자동 검증

```bash
npm run verify        # lint → typecheck → unit test → build → 브라우저 스모크 → Playwright E2E
```

`scripts/smoke.mjs`는 빌드 결과물을 임시 포트(`SMOKE_PORT`, 기본 3111)로 띄우고 Chromium으로 실제
화면을 조작한다. 시스템 Chromium 경로를 쓰며, 다른 위치면 `CHROMIUM_PATH`로 지정한다.

`npm run e2e`는 `e2e/`의 Playwright 스펙 8개를 별도 포트(`E2E_PORT`, 기본 3112)에서 실행한다.
`E2E_BASE_URL`을 주면 로컬 서버를 띄우지 않고 그 URL(예: Vercel 배포)을 검사한다.

### 단위 테스트 — `npm test` (177개, 2026-09-17 통과)

| 파일 | 덮는 내용 |
|---|---|
| `src/features/imports/csv.test.ts` | BOM·CRLF·인용부호 안 쉼표/개행/이중 인용부호, 물리적 행 번호, 헤더 불일치 거부, 행/바이트 한도, 열 개수, 앞자리 0 보존, Cafe24 상품목록 형식 판별·상품코드 매핑·`4500.00` 정규화, 공백 헤더(업로드 기본양식) 호환, 공급가 열 없는 양식(옵션/재고·재고정보) 거부 |
| `src/features/imports/validate.test.ts` | 정수/0원/앞자리 0 허용, 빈값·음수·통화·천 단위·소수·지수·공백·문자·범위초과 거부, 변경/동일 구분, 파일 내 중복(값 동일 포함), 미매칭, 열 개수 불일치, 플랫폼 중복 코드, 집계 |
| `src/features/imports/preview.test.ts` | 정상/오류/헤더 파일 집계와 차단, 몰별 격리, 품목 없는 몰, 파일 해시 안정성, 확정 가능 여부, 검토/변경/JSON 명세 |
| `src/lib/cafe24/gateway.test.ts` | fixture gateway의 몰별 품목 필터, 빈 몰 |
| `src/lib/cafe24/oauth.test.ts` | state 서명·변조·만료·mall_id 검증, authorize URL, 토큰 파싱·필수값, Basic 인증 토큰 교환·오류, 환경변수 누락 |
| `src/lib/cafe24/admin.test.ts` | 상품 응답 파싱(`products`/`resource`), 공급가 정규화·비정수 null, Bearer·limit/offset/shop_no/version 요청, 오류·잘못된 mall_id 거부 |
| `src/lib/cafe24/variants.test.ts` | 상품·품목 응답 파싱, 옵션명 합치기, 공급가 정규화·음수/소수/누락 null, 상품 5,000개 미만 페이지네이션, maxProducts 잘림, shop_no·`X-Cafe24-Api-Version` 헤더, 401/403 오류 |
| `src/lib/cafe24/gateway.test.ts` | `loadShopVariants`가 상품→품목을 훑어 `PlatformVariant`로 변환, 품목 없는 상품 집계, 공급가 누락 null, `Cafe24VariantGateway` 인터페이스 |
| `src/features/imports/store.test.ts` | (DB) 미리보기·행 저장, 같은 몰로만 조회, 다른 몰 차단, 상품목록 형식·헤더 오류 저장, 최근 작업 나열 |
| `src/features/imports/executor.test.ts` | 충돌 차단, 이미 목표값, 반영 안 됨, timeout 후 반영 확인/결과 불명, 429 재시도, 401/403/404 분류, 최종 상태 집계 |
| `src/features/imports/restore.test.ts` | 현재 값=목표값이면 복원, 이미 이전 값, 외부 변경 충돌, 비성공/금액 결손/현재값 미확인 오류, 집계 |
| `src/features/imports/runner.test.ts` | (DB) 확정 후 실행·재조회 성공, 충돌, 429 백오프 재시도, timeout 후 반영, 권한 철회 중단, 다른 인스턴스 리스 차단, 복원 실행, 복원 전 외부 변경 충돌 |
| `src/lib/cafe24/launch.test.ts` | launch 쿼리에서 `hmac` 제거, 실제 Cafe24 launch 쿼리 서명 검증, 변조·값 변경·빈 서명 거부 |
| `src/lib/cafe24/session.test.ts` | 43자 세션 토큰 생성·결정적 해시, 형식 거부, TTL·만료·철회 판정 |
| `src/lib/cafe24/token-lifecycle.test.ts` | 타임존 없는 시각의 KST 해석, 명시적 타임존 존중, refresh 사용 가능 판정, access/refresh 만료 분류와 margin |
| `src/lib/cafe24/shop-store.test.ts` | (DB) 연결 시 암호화 저장·복호화, upsert 멱등, 세션 발급·조회·만료·철회, refresh 회전 저장, 동시 refresh 1회 병합, refresh 만료 시 재인증 |
| `src/lib/crypto/secret-box.test.ts` | AES-256-GCM 왕복·유니코드, 매번 다른 IV, 다른 키·변조·형식 오류 거부, 키 길이 검증 |
| `src/lib/db/pool.test.ts` | `DATABASE_URL`/`POSTGRES_URL` 우선순위, migration용 unpooled 우선, sslmode 제거·TLS 결정, max 지정 |
| `src/features/imports/platform-snapshot.test.ts` | 현재 상품목록(Cafe24 상품목록/단순)을 매칭용 품목으로 변환, 공급가·코드 결손 행 건너뛰기, 미지원 형식 거부 |

### 브라우저 스모크 — `npm run smoke` (25개, 2026-09-16 통과)

| # | 기대 | 결과 |
|---|---|---|
| 1 | 데모 초기 화면 | 통과 |
| 2 | 정상 파일 전체 5행 | 통과 |
| 3 | 정상 파일 변경 1건 | 통과 |
| 4 | 정상 파일 동일 4건 | 통과 |
| 5 | 정상 파일 오류 0건 | 통과 |
| 6 | 정상 파일 주의 1건(0원) | 통과 |
| 7 | 검증 통과 배너 | 통과 |
| 8 | 확정 버튼 활성 | 통과 |
| 9 | 검토 결과 CSV 다운로드 | 통과 |
| 10 | 확정 안내에 무쓰기 고지 | 통과 |
| 11 | 오류 파일 확정 차단 | 통과 |
| 12 | 오류 파일 오류 9건 | 통과 |
| 13 | 확정 버튼 비활성 | 통과 |
| 14 | 중복 코드 오류 표시 | 통과 |
| 15 | 미매칭 오류 표시 | 통과 |
| 16 | 빈 공급가 오류 표시 | 통과 |
| 17 | 통화/천 단위 오류 표시 | 통과 |
| 18 | 소수 오류 표시 | 통과 |
| 19 | 미매칭 상품 코드 표시 | 통과 |
| 20 | 앞자리 0 코드 보존 | 통과 |
| 21 | 0원 주의 표시 | 통과 |
| 22 | 잘못된 헤더 거부 | 통과 |
| 23 | 베타몰 파일 변경 1건 | 통과 |
| 24 | 베타몰 미매칭 없음 | 통과 |
| 25 | 품목 없는 몰은 전부 미매칭 | 통과 |

### Playwright E2E — `npm run e2e` (38개, 2026-09-17 통과)

| 파일 | 덮는 흐름 |
|---|---|
| `e2e/home.spec.ts` | 소개 화면의 흐름·규칙·미포함 범위, 데모 링크 이동 |
| `e2e/demo.spec.ts` | 정상 파일 집계·확정 활성, 확정 안내, 검토/변경/JSON 다운로드, 오류 파일 차단과 행별 메시지, 잘못된 헤더 거부, 몰 전환 격리, 직접 올린 CSV 검증, Cafe24 상품목록 형식 매칭·정규화 |
| `e2e/oauth.spec.ts` | 루트 launch 파라미터 전달, launch hmac 검증(성공 302·실패 403·hmac 없음 허용), mall_id·shop_no 보존, authorize 302·state 쿠키·shop_no 전달, 빈 mall_id 기본값 대체, 잘못된 mall_id 400, state 없는 callback 400, 사용자 거부 400 |
| `e2e/imports-auth.spec.ts` | (DATABASE_URL 필요) 세션 없음/만료 안내, 유효 세션의 몰·shop_no·업로드 폼 표시, 다른 몰 쿼리 차단, 세션 재접속 시 launch 303, 다른 몰은 OAuth 재시작 |
| `e2e/imports-preview.spec.ts` | (DATABASE_URL 필요) 저장한 미리보기 읽기 전용 표시(집계·전후 값·미매칭), 상품목록 형식 안내, 다른 몰 검토 차단, 없는 검토 404 안내, 세션 없는 업로드 거부, 상품목록 CSV 차단, 헤더 오류 파일 저장 |
| `e2e/imports-execution.spec.ts` | (DATABASE_URL 필요) 작업 페이지 상태·행별 결과, 쓰기 비활성 안내와 확정·실행 차단, 복원 페이지 복원가능/충돌 구분, 다른 몰 작업 차단 |

## 수동 검증표

서버를 띄우고 직접 확인한다. `npm run smoke`가 덮지 않는 항목 위주로 본다.

| 화면/동작 | 확인 방법 | 기대 결과 |
|---|---|---|
| `/demo` 몰 전환 | 알파/베타/감마 선택 | 알파 10개, 베타 2개, 감마 0개 품목으로 매칭 결과가 달라진다 |
| `/demo` 직접 올리기 | 정상 CSV 업로드 | 업로드 파일명이 표시되고 같은 검증·미리보기가 재현된다 |
| `/demo` Cafe24 상품목록 | Cafe24에서 내려받은 상품목록 CSV 업로드 | 형식이 "Cafe24 상품목록"으로 표시되고 `공급가`의 `.00`이 정규화된다. 이 몰 품목에 해당 상품코드가 없으면 미매칭으로 남는다 |
| `/demo` 현재 상품목록 업로드 | `현재 상품목록 파일 (선택)`에 Cafe24 상품목록 CSV 업로드 | 매칭 품목 수가 표시되고, 이후 올린 변경 CSV가 실제 상품코드로 매칭된다 |
| `/demo` 업로드 기본양식 | `상품 코드`·`공급가` 열이 있는 Cafe24 업로드 양식 업로드 | 공백이 있어도 형식이 인식되고 `공급가`가 정규화된다 |
| `/demo` 공급가 없는 양식 | 옵션/재고 초기화 양식(A~M) 또는 재고 정보 업로드 양식 업로드 | "공급가 열이 없어 가져올 수 없습니다"로 거부된다 |
| `/demo` 인용부호 파일 | 값에 쉼표·개행이 든 셀 업로드 | 값이 잘리지 않고 그대로 오류 판정된다 |
| `/demo` 열 개수 오류 | `SKU-0001,4800,extra` 행 | 열 3개 오류로 표시되고 확정 불가 |
| `/demo` 확정 | 정상 파일에서 `확정 (데모)` | 미리보기 버전·해시와 함께 "실제 API 호출은 하지 않았습니다" 안내 |
| `/demo` 파일 변경 | 오류 파일 → 정상 파일로 전환 | 해시가 바뀌고 이전 확정 안내가 사라진다 |
| `/demo` 명세 내보내기 | 검토 CSV·변경 명세 CSV·JSON 명세 | 검토는 전체 행, 변경 명세는 변경 행만, JSON은 변경 목록·차단 사유 포함 |
| `/demo` CSV 인코딩 | 내려받은 검토 CSV를 Excel로 열기 | 한글 헤더가 깨지지 않는다(BOM 포함) |
| `/` 규칙 안내 | 소개 화면 | 매칭·금액·차단 규칙과 "데모에 없는 것"이 보인다 |
| 앱 실행 진입 | App URL을 루트(`/`)로 두고 몰에서 앱 실행 | `hmac` 포함 launch 파라미터가 `proxy`→`launch`→`start`를 거쳐 authorize 동의 화면으로 이어진다 |
| launch 서명 | `hmac`을 변조해 `/api/cafe24/launch` 호출 | 403으로 거부된다 |
| OAuth 시작 | `CAFE24_*` 설정 후 `/api/cafe24/oauth/start?mall_id=<몰>` | `https://<몰>.cafe24api.com/api/v2/oauth/authorize?...&scope=mall.read_product mall.write_product mall.read_store`로 302 |
| OAuth 콜백 | 인증 승인 후 callback | `/imports/new`로 303 이동하고 몰·shop_no·scope·만료 시각이 보인다. 토큰·공급가 값은 보이지 않는다. `state` 불일치·만료는 400 |
| OAuth 미설정 | `CAFE24_*` 없이 start 호출 | 누락된 환경변수를 나열한 500 |
| 작업 화면 진입 | 세션 쿠키 없이 `/imports/new` | "Cafe24 연결이 필요합니다"와 다시 연결 버튼 |
| 품목 조회 | `/imports/new`에서 “품목 조회” | 상품 수와 공급가를 읽은 수가 보이고 값은 보이지 않는다. 실패하면 “다시 시도”로 재조회 |
| 세션 지속 | 서버 재시작 후 `/imports/new` 새로고침 | DB 세션이 살아 있어 작업 화면이 유지된다(메모리 저장소 아님) |
| 몰 격리 | 다른 몰 세션으로 `/imports/new?mall_id=다른몰` | 세션의 몰과 다르면 작업 화면 대신 다시 연결 안내 |
| 재인증 | DB에서 refresh 만료로 바꾸고 `/imports/new` | “Cafe24 재인증이 필요합니다” 안내 |
| launch 재접속 | 같은 몰 세션이 있는 상태로 앱 재실행 | OAuth 동의 화면 없이 `/imports/new`로 이동 |
| 실제 품목 미리보기 | `CAFE24_API_VERSION=2026-09-01` 후 `variant_code,supply_price` CSV 업로드 | 상품→품목을 조회해 현재/목표 공급가·변경/동일/오류가 보인다. `supply_price`가 없으면 0으로 보지 않고 오류로 막는다 |
| 공급가 미반환 | API 버전을 비우거나 구버전으로 두고 업로드 | `unknown_before_price`로 확정이 막히고 버전 설정 필요를 알 수 있다 |
| 상품목록 CSV 차단 | `상품코드`·`공급가` 파일 업로드 | `variant_code` 형식 안내와 함께 막히고 검토가 만들어지지 않는다 |
| 다른 몰 검토 차단 | 다른 몰 세션으로 `/imports/[id]/preview` 접근 | “검토를 찾을 수 없습니다”만 보이고 내용은 노출되지 않는다 |
| 한 품목 쓰기 (수동) | `IMPORT_WRITE_ENABLED=true` 후 테스트몰 한 품목만 `variant_code,supply_price`로 업로드 → 확정 → 실행 | 통과(2026-09-21, 온누리 젤펜 A 2000→2300): 공급가가 목표값으로 바뀌고 행 상태 성공(“목표값 반영을 확인했습니다”). 판매가·재고·진열 등 다른 필드는 요청에 넣지 않음 |
| 동일 행 (수동) | 현재 값과 같은 목표값을 올려 실행 | 통과: 행 상태 동일/성공(“이미 목표값”). 쓰기 없음 |
| 쓰기 충돌 (수동) | 미리보기 후 관리자에서 그 품목 공급가를 직접 바꾸고 실행 | 행 상태가 충돌로 남고 값은 덮어쓰지 않는다 |
| 복원 (수동) | 쓰기 성공 후 작업 페이지에서 “복원 검토 만들기” → 실행 | 통과(2026-09-21, A 2300→2000): 현재 값이 목표값이면 이전 값으로 복원되고 결과 성공. 관리자에서 값이 다르면 충돌로 남는다 |
| timeout/결과 불명 (수동) | 쓰기 직후 네트워크를 끊거나 서버 응답을 지연 | 결과 불명으로 남고 재조회 후 성공/재시도로 분류된다. 맹목 재시도하지 않는다 |
| 캐시로 인한 오판 방지 (수동) | 쓰기 직후 곧바로 재조회(캐시가 약 5초간 이전 값 반환) | 재조회를 제한적으로 재시도해 성공/복원을 오판하지 않는다. 실측: 캐시가 2000/2300을 오가다 약 5초 뒤 수렴 |
| 미리보기 안내 | `/imports/[id]/preview` | 쓰기 활성 시 “확정 후 실행하면 반영” 안내, 비활성 시 조회·검토만 안내 |

## 알려진 한계 (B 단계에서 확인 필요)

- 실제 onnurimun 상품목록 내보내기 3개(88·92열)는 상품 단위이며 옵션/품목 코드가 없다. `상품코드` 기준
  매칭만 가능하고, 옵션별 공급가를 다루려면 옵션·품목이 포함된 내보내기나 API 조회가 필요하다.
- 업로드 기본양식은 실제 파일을 받아 검증하지 않았다. 헤더는 공식 문서 표기를 근거로 공백 무시 매칭만 넣었다.
  `옵션/재고 초기화 양식`·`재고 정보 업로드 양식`은 공급가 열이 없어 거부하는 것이 의도된 동작이다.
- 현재 상품목록 업로드는 파일 기반이다. 실제 서비스에서는 Cafe24 API 조회로 대체한다(토큰 영속 저장 필요).
- OAuth 콜백·토큰 교환·state 검증·refresh 잠금, 토큰 암호화 DB 저장, 세션, `/imports/new`·`/imports/[id]/preview`
  까지 구현했다. 실제 품목 gateway는 상품 목록(페이지네이션)을 훑은 뒤 상품마다 품목을 조회한다(N+1).
  상품 수 상한(`IMPORT_MAX_PRODUCTS`, 기본 500)을 두고 초과 시 잘림을 표시하므로, 큰 몰에서는 호출이 많다.
- 상품 5,000개 초과 시 `offset`을 쓸 수 없다는 문서 제약(`sin_product_no` 필요)은 아직 구현하지 않았다.
- `supply_price`는 품목 조회 응답에 반환되고 쓰기·복원도 성공함을 실제 호출로 확인했다(2026-09-21).
  최대값·음수 허용 범위는 아직 실제 호출로 확인하지 않았다(`docs/cafe24-api-notes.md`의 미확인 항목).
  품목 응답 문자열 금액은 소수점 이하가 0일 때만 정수로 정규화하며, 그 외는 null로 두고 오류 처리한다.
- refresh는 DB 트랜잭션 안에서 advisory 잠금을 잡고 토큰을 갱신한다. 잠금을 잡은 채 토큰 HTTP 호출(최대 15초)을
  하므로 동시 refresh는 억제되지만 그동안 DB 연결 하나를 점유한다(파일럿 규모 전제).
- access token 만료 시각을 읽지 못하면 재조회 없이 토큰을 쓰고, 401 재시도는 아직 없다.
- 작업 화면의 “품목 조회”만 실제 Admin API를 호출한다. 상품 목록을 옵션별 품목으로 간주하지 않으며, 옵션/품목
  조회는 별도 엔드포인트 확인이 필요하다.
- 상품·품목 조회 응답 필드(`products`/`variants`, `supply_price`, `shop_no`)와 `X-Cafe24-Api-Version`
  헤더는 테스트몰에서 실제 호출로 확인했다. 단, ‘공급가 관리 방식’은 API에 노출되지 않아 관리자 UI에서만
  바꿀 수 있고, 앱은 그 값 자체를 사전 점검할 수 없다(422 안내로 대체).
- 실제 테스트몰에서 authorize→code→token 전체 흐름을 아직 실행하지 않았다. scope 승인·`shop_no`/`user_id`
  값은 문서 기반이다.
- `product_no`/`variant_code`/`shop_no`의 정확한 관계와 금액 정밀도·허용 범위는 미확인이다. 데모는
  KRW 정수 원 단위만 다룬다.
- 쓰기 실행 코드는 **기본 비활성**(`IMPORT_WRITE_ENABLED` 미설정)이며, 한 품목 쓰기·재조회·복원과
  2행 앱 파일럿은 테스트몰에서 통과했다(2026-09-21). 운영 배포에서 켤지는 별도 판단이다.
- **onnurimun 쓰기 가능 조건**: 몰의 ‘공급가 관리 방식’이 ‘품목 단위’여야 한다(관리자 UI 전용, API 미노출).
  ‘상품 단위’이면 `422 Supply price by item cannot be modified.`(옵션 있는 상품), 옵션 없는 단일 품목 상품은
  `Single product cannot be modified.`. `calculate_price_based_on=S`는 별도 설정(‘판매가 계산 기준’)이다.
  상세·X-Trace_ID는 `docs/cafe24-api-notes.md`, 사용자 안내는 `docs/user-guide.md`.
- **Cafe24 조회 캐시**: 품목 조회 API는 `Cache: Enabled`라 쓰기 직후 재조회가 약 5초간 이전 값을 돌려준다
  (실측: 2000/2300을 오가다 수렴). 이 앱은 쓰기 후 재조회와 ‘이미 목표값’ 확인을 제한적으로 재시도해
  오판을 막는다(`executor.ts`). 재조회 재시도는 최대 6회·1초 간격이다.
- 점검 도구: `scripts/live-probe.mjs`(읽기 전용), `scripts/live-write-check.mjs`(품목 공급가 1건 쓰기·원복),
  `scripts/live-variant-read.mjs`(목록/단건 값 비교), `scripts/live-trace.mjs`(PUT 상태·X-Trace_ID),
  `scripts/token-refresh.mjs`(만료 토큰 회전·저장). 모두 토큰·금액 원문을 출력하지 않는다.
- `PUT .../variants/{variant_code}` 요청 본문 `{ shop_no, request: { supply_price: "4500.00" } }`는
  실제 호출에서 200으로 확인됐다(2026-09-21). 응답 422 본문의 `error.code`/`error.message`도 저장한다.
- worker는 큐·스케줄 기반 상시 프로세스가 아니라 요청 단위 실행이며, 시간 예산 초과 시 남은 행을 두고
  다음 실행에서 재개한다. 브라우저/요청이 끝나도 상태는 DB에 남지만 자동으로 이어서 돌지는 않는다.
- 작업/복원 페이지에서 결과 파일 다운로드는 아직 없다. 파일·원가·작업 이력의 보관기간·삭제 정책도 미정이다.
- 실행 직전 재조회·timeout/결과 불명 분류·부분 실패·복원은 구현·검증됐다(2행 파일럿). 다만 큰 배치에서의
  시간 예산 초과·부분 실패·재개는 실제 대량 파일로 검증하지 않았다.
- 상품명 유사도 자동 매칭, 공급사 파일 전 형식 자동 해석, 판매가·재고 변경은 다루지 않는다.
- 데모 완성은 수요 검증이 아니다. 노출·지불·API 권한·가격·지속 투자 게이트는 미확정이다.

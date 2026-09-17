# cafe24-variant-cost-import

**공급사 원가표(CSV)를 Cafe24 품목에 매칭하고 변경점을 검토한 뒤 옵션별 공급가만 수정**하는 앱 후보의
로컬 데모입니다. 판매가 예약·재고 수정과는 다른 작업입니다.

`plan.md`의 **A. 2시간 데모**(합성 데이터)가 완료되어 있고, **B. 한 품목 쓰기 검증**의 첫 조각으로
Cafe24 OAuth 콜백·토큰 교환·앱 실행(launch) 서명 검증을 스캐폴딩했습니다. CSV는 자체 형식
(`variant_code,supply_price`)과 **Cafe24 상품목록 내보내기 형식**(`상품코드`·`공급가`)을 자동 판별해
읽습니다. 품목/옵션 조회·공급가 쓰기와 DB 저장은 아직 없으며, 어느 단계에서도 실제 품목 값을 바꾸지 않습니다.

## 실행

```bash
mise install          # node 26.8.2
npm install
cp .env.example .env.local   # Cafe24 앱 인증정보 입력 (OAuth를 쓸 때만)
npm run dev           # http://localhost:3000
```

| 경로 | 용도 |
|---|---|
| `/` | 소개·매칭·검증 규칙 |
| `/demo` | 몰·합성 파일(또는 직접 올린 CSV) 선택 → 검증·변경 미리보기·행별 오류·명세 내보내기. **현재 상품목록 파일**을 올리면 그 목록을 실제 매칭 기준으로 사용 |
| `/` + launch 파라미터 | `hmac`·`mall_id`가 있으면 `src/proxy.ts`가 launch 경로로 307 |
| `/api/cafe24/launch` | Cafe24 앱 실행 진입점. `hmac`을 검증하고 `mall_id`·`shop_no`를 보존해 start로 302 |
| `/api/cafe24/oauth/start` | Cafe24 authorize로 302 (state 서명 쿠키 발급, `?mall_id=` 필요/기본값, `shop_no` 전달) |
| `/api/cafe24/oauth/callback` | state 검증 → 토큰 교환 → 메모리 저장, 결과 요약 페이지(토큰 값은 노출하지 않음) |

## 검증

```bash
npm test              # 단위 테스트 94개
npm run smoke         # 빌드 결과물을 임시 포트로 띄워 Chromium으로 25개 확인
npm run e2e           # Playwright E2E 21개 (빌드 후 임시 포트에서 실행)
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
  platform-snapshot.ts 업로드한 현재 상품목록(상품코드·공급가)을 매칭용 품목으로 변환
src/lib/cafe24/
  gateway.ts          VariantGateway 인터페이스 + FixtureVariantGateway
  env.ts              CAFE24_* 환경변수 읽기·검사
  oauth.ts            scope, state 서명/검증, authorize URL, 토큰 교환·refresh
  admin.ts            Admin API 상품 조회(Bearer), 응답 파싱·공급가 정규화
  token-store.ts      메모리 토큰·상품 스냅샷 저장소 + refresh 잠금(스캐폴드)
src/app/api/cafe24/oauth/
  start/route.ts      CSRF state 쿠키 발급 후 authorize로 리다이렉트
  callback/route.ts   state 검증 → 토큰 교환 → 요약 페이지
src/lib/download.ts   브라우저 CSV/JSON 다운로드
src/fixtures/         합성 몰·품목·정상/오류 CSV
scripts/smoke.mjs     브라우저 스모크
e2e/                  Playwright E2E
```

`src/features/jobs/`·`src/workers/`·`db/migrations/`는 이후 B/C 단계에서 추가한다.

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
- **안전성**: 원가 데이터는 영업정보다. 일반 로그에 원가·원본 파일을 출력하지 않고, 실제 API 호출·쓰기가
  없으며, 확정 안내에 무쓰기를 명시한다.

## OAuth (B단계 스캐폴드)

- scope: `mall.read_product`, `mall.write_product`, `mall.read_store`만 요청한다(운영자 권한).
- state: HMAC-SHA256 서명 + 10분 만료, HttpOnly·SameSite=Lax 쿠키와 비교해 CSRF를 막는다.
- `mall_id`는 정규식으로 검증해 authorize/token 호스트가 조작되지 않게 한다.
- 토큰은 서버 메모리에만 보관하고 응답 페이지·로그에 값을 출력하지 않는다. `refreshStoredToken`이
  회전된 refresh token까지 저장한다. refresh는 토큰 요청 timeout(15초)과 `withRefreshLock`으로 한
  인스턴스 안에서 1회로 합치지만, 서버리스에서는 인스턴스별로만 동작한다. 메모리 저장소는 서버 재시작 시
  사라지므로 B단계에서 암호화된 DB ledger로 교체한다.
- 앱 실행(launch): 루트로 들어온 `hmac`·`mall_id`를 `src/proxy.ts`가 launch 경로로 넘기고,
  `verifyLaunchHmac`이 원본 쿼리 문자열에서 `hmac`을 뺀 값의 `base64(HMAC-SHA256)`를 클라이언트 시크릿으로
  검증한다. 검증에 쓰는 쿼리는 재조립하지 않고 요청 URL 그대로를 사용한다.
- 콜백에서 토큰을 받은 뒤 `GET /api/v2/admin/products`로 상품을 조회해 메모리 스냅샷에 저장하고,
  연결 결과 페이지에 조회한 상품 수와 공급가를 읽은 수만 표시한다(공급가 값은 노출하지 않음).
- 아직 공급가 쓰기는 하지 않는다. 상품 조회는 `products`/`resource` 배열과 `supply_price`를 방어적으로
  읽으며, 실제 응답 필드는 테스트몰에서 확정해야 한다(요청 시 `CAFE24_API_VERSION`을 `version`으로 전달).

## 다음 단계 (B/C)

`plan.md` 6장의 공식 문서·테스트몰 확인 과제를 먼저 수행한 뒤, 실제 `VariantGateway`(scope·버전),
Postgres 작업 ledger(`db/migrations/`), 실행 worker·재조회·복원, 충돌·timeout·삭제 품목 대응을 붙인다.

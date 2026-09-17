# QA — 옵션별 공급가 CSV 가져오기 (로컬 데모)

`plan.md` **A. 2시간 데모**의 검증표다. 현재 범위는 합성 품목·합성 CSV만 사용하는 데모이며,
**B. 한 품목 쓰기 검증**과 **C. 작은 배치 파일럿**은 아직 착수하지 않았다.

- 작성일: 2026-09-16
- 범위: CSV 파싱·검증·정확 매칭·변경 미리보기·행별 오류·확정 차단·명세 내보내기
- 설치·API 한도: **소모 없음.** 실제 Cafe24 앱 설치, OAuth, 품목/옵션 API 호출, 공급가 쓰기를
  하지 않는다. 모든 데이터는 `src/fixtures/`의 합성 품목과 CSV에만 존재한다.

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

### 단위 테스트 — `npm test` (69개, 2026-09-17 통과)

| 파일 | 덮는 내용 |
|---|---|
| `src/features/imports/csv.test.ts` | BOM·CRLF·인용부호 안 쉼표/개행/이중 인용부호, 물리적 행 번호, 헤더 불일치 거부, 행/바이트 한도, 열 개수, 앞자리 0 보존 |
| `src/features/imports/validate.test.ts` | 정수/0원/앞자리 0 허용, 빈값·음수·통화·천 단위·소수·지수·공백·문자·범위초과 거부, 변경/동일 구분, 파일 내 중복(값 동일 포함), 미매칭, 열 개수 불일치, 플랫폼 중복 코드, 집계 |
| `src/features/imports/preview.test.ts` | 정상/오류/헤더 파일 집계와 차단, 몰별 격리, 품목 없는 몰, 파일 해시 안정성, 확정 가능 여부, 검토/변경/JSON 명세 |
| `src/lib/cafe24/gateway.test.ts` | fixture gateway의 몰별 품목 필터, 빈 몰 |
| `src/lib/cafe24/oauth.test.ts` | state 서명·변조·만료·mall_id 검증, authorize URL, 토큰 파싱·필수값, Basic 인증 토큰 교환·오류, 환경변수 누락 |
| `src/lib/cafe24/token-store.test.ts` | refresh 결과(회전된 refresh token) 저장, 동시 refresh 1회 병합, 실패 후 잠금 해제 |

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

### Playwright E2E — `npm run e2e` (15개, 2026-09-17 통과)

| 파일 | 덮는 흐름 |
|---|---|
| `e2e/home.spec.ts` | 소개 화면의 흐름·규칙·미포함 범위, 데모 링크 이동 |
| `e2e/demo.spec.ts` | 정상 파일 집계·확정 활성, 확정 안내, 검토/변경/JSON 다운로드, 오류 파일 차단과 행별 메시지, 잘못된 헤더 거부, 몰 전환 격리, 직접 올린 CSV 검증 |
| `e2e/oauth.spec.ts` | launch의 mall_id·shop_no 보존, authorize 302·state 쿠키·shop_no 전달, 빈 mall_id 기본값 대체, 잘못된 mall_id 400, state 없는 callback 400, 사용자 거부 400 |

## 수동 검증표

서버를 띄우고 직접 확인한다. `npm run smoke`가 덮지 않는 항목 위주로 본다.

| 화면/동작 | 확인 방법 | 기대 결과 |
|---|---|---|
| `/demo` 몰 전환 | 알파/베타/감마 선택 | 알파 10개, 베타 2개, 감마 0개 품목으로 매칭 결과가 달라진다 |
| `/demo` 직접 올리기 | 정상 CSV 업로드 | 업로드 파일명이 표시되고 같은 검증·미리보기가 재현된다 |
| `/demo` 인용부호 파일 | 값에 쉼표·개행이 든 셀 업로드 | 값이 잘리지 않고 그대로 오류 판정된다 |
| `/demo` 열 개수 오류 | `SKU-0001,4800,extra` 행 | 열 3개 오류로 표시되고 확정 불가 |
| `/demo` 확정 | 정상 파일에서 `확정 (데모)` | 미리보기 버전·해시와 함께 "실제 API 호출은 하지 않았습니다" 안내 |
| `/demo` 파일 변경 | 오류 파일 → 정상 파일로 전환 | 해시가 바뀌고 이전 확정 안내가 사라진다 |
| `/demo` 명세 내보내기 | 검토 CSV·변경 명세 CSV·JSON 명세 | 검토는 전체 행, 변경 명세는 변경 행만, JSON은 변경 목록·차단 사유 포함 |
| `/demo` CSV 인코딩 | 내려받은 검토 CSV를 Excel로 열기 | 한글 헤더가 깨지지 않는다(BOM 포함) |
| `/` 규칙 안내 | 소개 화면 | 매칭·금액·차단 규칙과 "데모에 없는 것"이 보인다 |
| 앱 실행 진입 | App URL을 `/api/cafe24/launch`로 등록 후 몰에서 앱 실행 | authorize로 이어져 동의 화면이 뜬다 |
| OAuth 시작 | `CAFE24_*` 설정 후 `/api/cafe24/oauth/start?mall_id=<몰>` | `https://<몰>.cafe24api.com/api/v2/oauth/authorize?...&scope=mall.read_product mall.write_product mall.read_store`로 302 |
| OAuth 콜백 | 인증 승인 후 callback | 연결 완료 페이지에 mall·scope·만료 시각이 보이고 토큰 값은 보이지 않는다. `state` 불일치·만료는 400 |
| OAuth 미설정 | `CAFE24_*` 없이 start 호출 | 누락된 환경변수를 나열한 500 |

## 알려진 한계 (B 단계에서 확인 필요)

- OAuth 콜백·토큰 교환·state 검증·refresh 잠금만 구현했다. 품목 조회/공급가 쓰기, 토큰의 암호화 DB 저장은
  아직 없다(메모리 저장소는 재시작 시 소실). `VariantGateway`는 여전히 인터페이스와 fixture 구현만 있다.
- 실제 테스트몰에서 authorize→code→token 전체 흐름을 아직 실행하지 않았다. scope 승인·`shop_no`/`user_id`
  값은 문서 기반이다.
- `product_no`/`variant_code`/`shop_no`의 정확한 관계와 금액 정밀도·허용 범위는 미확인이다. 데모는
  KRW 정수 원 단위만 다룬다.
- 서버 저장(Postgres)·worker·재조회·복원·충돌 처리는 없다. 상태는 페이지 메모리에만 있고 새로고침하면
  초기화된다.
- 실행 직전 재조회·timeout/결과 불명 분류·부분 실패·복원은 구현하지 않았다(`plan.md` 5장, B/C).
- 상품명 유사도 자동 매칭, 공급사 파일 전 형식 자동 해석, 판매가·재고 변경은 다루지 않는다.
- 데모 완성은 수요 검증이 아니다. 노출·지불·API 권한·가격·지속 투자 게이트는 미확정이다.

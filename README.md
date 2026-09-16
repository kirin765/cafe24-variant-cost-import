# cafe24-variant-cost-import

**공급사 원가표(CSV)를 Cafe24 품목에 매칭하고 변경점을 검토한 뒤 옵션별 공급가만 수정**하는 앱 후보의
로컬 데모입니다. 판매가 예약·재고 수정과는 다른 작업입니다.

현재 구현 범위는 `plan.md`의 **A. 2시간 데모**(합성 데이터)입니다. 실제 Cafe24 OAuth·품목/옵션
API·DB 저장은 **B. 한 품목 쓰기 검증**에서 다룹니다. 지금은 합성 품목 목록과 합성 CSV만 사용하며,
어느 단계에서도 실제 품목 값을 바꾸지 않습니다.

## 실행

```bash
mise install          # node 26.8.2
npm install
npm run dev           # http://localhost:3000
```

| 경로 | 용도 |
|---|---|
| `/` | 소개·매칭·검증 규칙 |
| `/demo` | 몰·합성 파일(또는 직접 올린 CSV) 선택 → 검증·변경 미리보기·행별 오류·명세 내보내기 |

## 검증

```bash
npm test              # 단위 테스트 50개
npm run smoke         # 빌드 결과물을 임시 포트로 띄워 Chromium으로 25개 확인
npm run verify        # lint → typecheck → test → build → smoke
```

자세한 기대 결과와 한도 소모 여부는 `QA.md`에 있다.

## 구조

```text
src/features/imports/
  model.ts            CSV 행·품목·미리보기·이슈 타입과 파일 한도
  csv.ts              UTF-8/BOM·인용부호·CRLF 지원 CSV parser, 헤더·행/바이트 한도 검사
  validate.ts         금액 파싱·정확 매칭·중복/미매칭 오류·변경 계산·집계
  preview.ts          미리보기 조립, 확정 차단 사유, 검토/변경/JSON 명세 출력
  hash.ts             파일 내용 해시( 미리보기 버전 연결)
src/lib/cafe24/
  gateway.ts          VariantGateway 인터페이스 + FixtureVariantGateway
src/lib/download.ts   브라우저 CSV/JSON 다운로드
src/fixtures/         합성 몰·품목·정상/오류 CSV
scripts/smoke.mjs     브라우저 스모크
```

`src/features/jobs/`·`src/workers/`·`db/migrations/`는 B/C 단계에서 추가한다.

## 설계 요약

- **정확 매칭만**: `variant_code`의 플랫폼 코드 완전 일치만 사용한다. 상품명·옵션명은 검토 화면의
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
- **안전성**: 원가 데이터는 영업정보다. 일반 로그에 원가·원본 파일을 출력하지 않고, 실제 API 호출·쓰기가
  없으며, 확정 안내에 무쓰기를 명시한다.

## 다음 단계 (B/C, 미착수)

`plan.md` 6장의 공식 문서·테스트몰 확인 과제를 먼저 수행한 뒤, 실제 `VariantGateway`(OAuth·scope·버전),
Postgres 작업 ledger(`db/migrations/`), 실행 worker·재조회·복원, 충돌·timeout·삭제 품목 대응을 붙인다.

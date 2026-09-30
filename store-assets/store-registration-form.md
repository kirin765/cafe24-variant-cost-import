# 옵션별 공급가 CSV 가져오기 — 개발자센터 / 스토어 등록 입력값

붙여넣을 값과 업로드 파일을 폼 순서대로 적었다. 이미지 항목은 저장소 파일 경로를 적었다.
카피 원본은 `store-listing-copy.md`에 있다. 글자 수/바이트는 UTF-8 기준(한글 1자 = 3B)이다.

---

## 0. 코드에서 가져와야 하는 값 (이 폼에 필요한 데이터)

| 폼 항목 | 코드/배포에서 오는 값 | 현재 상태 |
|---|---|---|
| App URL | `https://cafe24-variant-cost-import.vercel.app/api/cafe24/launch` | 배포됨. launch hmac 검증 후 세션 재접속 또는 OAuth 시작 (`src/app/api/cafe24/launch/route.ts`) |
| Redirect URI(s) | `https://cafe24-variant-cost-import.vercel.app/api/cafe24/oauth/callback` | `.env.local`의 `CAFE24_REDIRECT_URI`와 문자 단위로 같아야 함 |
| 권한(Scope) | `mall.read_product, mall.write_product, mall.read_store` | `src/lib/cafe24/oauth.ts`. 개발자센터 권한 선택과 **정확히 일치**해야 함 |
| Client ID / Secret | 개발자센터 값 → Vercel `CAFE24_CLIENT_ID`·`CAFE24_CLIENT_SECRET` | 설정됨 |
| API 버전 | `CAFE24_API_VERSION` = `2026-09-01` | 유효기간 1년(2027-09-01까지). 만료 전 갱신 |
| 샘플 사이트 URL | `https://cafe24-variant-cost-import.vercel.app` | 배포됨(데모·작업 화면). '샘플 사이트'에 사용 |
| 지원 언어 | 한국어 | 코드·UI 모두 한국어 |
| 문의 이메일 | `kwan765@naver.com` | 기존 앱과 동일 |
| 개인정보처리방침 URL | (미구현) | 필요 시 `/privacy` 추가 후 입력 |

**아직 확정되지 않은 값**

| 항목 | 상태 |
|---|---|
| WebHook | 미등록 (수신 엔드포인트 미구현). 앱 삭제 시 토큰 정리는 추후 |
| 홍보 동영상 | 없음 → 비움 (대표설명 이미지가 대신 노출) |
| 테스트몰 계정 | 심사 제출 메일에 필요 (다른 앱과 동일한 `onnurimun` 사용) |
| 개인정보처리방침 | 미구현. 심사에서 요구하면 추가 |

---

## 1. 기본정보 / API 정보

| 필드 | 입력값 |
|---|---|
| App URL | `https://cafe24-variant-cost-import.vercel.app/api/cafe24/launch` |
| 표시 방식 | **새 창 열기** (기본값) |
| Redirect URI(s) | `https://cafe24-variant-cost-import.vercel.app/api/cafe24/oauth/callback` |
| 유형 | Web application (Authorization Code) |
| 타임존 | Asia/Seoul (UTC+09:00) |
| API 버전 | `2026-09-01` |
| 운영자 권한확인 URI | **비움** (운영자별 권한 제어 미구현) |
| Front API 사용여부 | **사용안함** (서버에서 Admin API만 호출) |
| WebHook | **미등록** |

### 권한선택 (쇼핑몰 운영자) — 중요

동작에 필요한 최소 권한만 요청한다. 코드가 요청하는 scope와 정확히 같아야 한다:
`mall.read_product,mall.write_product,mall.read_store`

| No | 분류 | 선택 | 이유 |
|---|---|---|---|
| 1 | 앱 | 읽기 (고정) | 앱 실행·세션. 쓰기 권한 불필요 |
| 2 | 상품(Product) | **읽기+쓰기** (`mall.read_product`·`mall.write_product`) | 품목 조회와 공급가(supply_price) 수정에 필요 |
| 3 | 상점(Store) | 읽기 (`mall.read_store`) | 몰 정보·shop_no 확인 |
| 4 | 그 외(주문·회원·프로모션 등) | **선택 안 함** | 사용하지 않음 |

- **권한선택 (쇼핑몰 고객)**: **선택 안 함** (고객 정보를 조회하지 않는다)

---

## 2. 판매 정보 (한국어)

### 텍스트 필드

| 입력란 | 입력값 |
|---|---|
| 판매 상품명 | `옵션별 공급가 CSV 가져오기` |
| 카테고리 | **상품/편집/콘텐츠** 권장 (상품 공급가 편집·가져오기) |
| 대표설명 이미지 | `store-assets/banner-740x416.png` (740×416, PNG, 204KB) |
| 대표설명 핵심 문구 (1~200B) | `공급사 원가표 CSV를 Cafe24 품목 코드로 매칭해, 바뀔 옵션별 공급가를 미리 검토한 뒤 한 번에 반영합니다.` (105B) |

### 대표아이콘

| 항목 | 값 |
|---|---|
| 파일 | `store-assets/icon-100.png` (100×100, PNG, 9KB) |
| 정사각형·둥근 모서리 없음 | ✓ (스토어가 자동으로 둥글게 처리) |
| 심볼 중앙 배치 | ✓ (₩ 심볼 + CSV 배지가 중앙) |
| 예비 | `store-assets/icon-256.png`, `icon-512.png` |

생성: `node store-assets/render-icon-banner.mjs`

### 대표설명 이미지

| 항목 | 값 |
|---|---|
| 파일 | `store-assets/banner-740x416.png` (740×416, PNG) |
| 흰 배경 아님·진한 색 | ✓ (남색→딥블루 그라데이션 + 흰/시안 글자) |
| 문구 | `공급사 원가표 CSV를 / 옵션별 공급가로` |

### 기본 정보

| 항목 | 값 |
|---|---|
| 홍보 동영상 URL | **비움** (없음) |
| 샘플 사이트 URL | `https://cafe24-variant-cost-import.vercel.app` |

### 스크린샷

**PC 1920×1080 (1MB 이하, 3장 이상)** — 5장 준비됨

| 파일 | 내용 |
|---|---|
| `store-assets/screenshots/pc-01-new.png` | 작업 화면 — 몰·scope·공급가 관리 방식 안내·CSV 업로드 |
| `store-assets/screenshots/pc-02-preview.png` | 변경 미리보기 — 요약 + 품목별 변경 전·후 공급가 |
| `store-assets/screenshots/pc-03-errors.png` | 오류 차단 — 미매칭·빈 코드·중복 |
| `store-assets/screenshots/pc-04-run.png` | 실행 결과 — 성공·충돌·결과 불명 |
| `store-assets/screenshots/pc-05-restore.png` | 복원 검토 — 복원 가능/충돌 |

**Mobile 360×640 (1MB 이하, 3장 이상)** — 4장 준비됨

| 파일 | 내용 |
|---|---|
| `store-assets/screenshots/mobile-01-preview.png` | 변경 미리보기 |
| `store-assets/screenshots/mobile-02-errors.png` | 오류 차단 |
| `store-assets/screenshots/mobile-03-new.png` | 작업 화면 |
| `store-assets/screenshots/mobile-04-run.png` | 실행 결과 |

재생성:
```
npm run db:migrate
npm run build && IMPORT_WRITE_ENABLED=true npx next start -p 3999
BASE_URL=http://127.0.0.1:3999 node store-assets/render-screenshots.mjs
```

### 상세 설명

**메인타이틀 (1~100B)**

```
공급사 원가표 CSV를 옵션별 공급가로, 검토하고 한 번에
```

(90B)

**핵심포인트 (3개 이상, 각 1~200B — 아래 6개)**

```
공급사 원가표(CSV)를 올리면 Cafe24 품목 코드와 정확히 매칭합니다
변경 전·후 공급가를 미리보기로 확인한 뒤에만 반영합니다
중복 코드·미매칭·잘못된 숫자는 오류로 표시하고 확정을 막습니다
확정한 작업만 실행하고, 행별 성공·실패·충돌·결과 불명을 남깁니다
변경 전 값으로 되돌리는 복원 검토를 별도 작업으로 제공합니다
판매가·재고·옵션 추가금액은 건드리지 않고 공급가만 바꿉니다
```

**상세 설명 본문 (HTML 방식)**

- `store-assets/store-detail.html` 내용 전체를 **Code View(HTML)**에 붙여넣는다.
- 안의 이미지 3장은 `https://cafe24-variant-cost-import.vercel.app/store/detail-01.png` ~ `-03.png`를 가리킨다. `public/store/`를 **먼저 배포한 뒤** 붙여넣는다.
- 이미지에 alt 텍스트를 넣었고 표시 폭은 1240px(권장 상한)이다.
- 텍스트만 입력하는 칸이 따로 있으면 `store-listing-copy.md`의 **상세 설명(텍스트판)**을 쓴다.

**FAQ** (`store-listing-copy.md`의 표를 그대로 쓴다)

### 사용 정보

| 항목 | 값 |
|---|---|
| 필수 요구조건 | `Cafe24 쇼핑몰 연결과 상품·품목 조회, 품목 공급가 수정 권한이 필요합니다. 쇼핑몰의 '공급가 관리 방식'이 '품목 단위'여야 하며, 옵션이 있는 상품을 대상으로 합니다.` |
| 사용권한 | 앱 읽기 / 상품 읽기+쓰기 / 상점 읽기 |
| 지원 언어 | Korean |
| 연관검색어 | `공급가;원가;매입가;공급가 수정;옵션 공급가;품목 공급가;원가표;CSV 가져오기;공급가 일괄수정;상품 원가` |

### 상품정보제공 고시

`cafe24-quotation-export`·`cafe24-option-detail`과 동일(같은 판매자).

| 항목 | 값 |
|---|---|
| 제작사 또는 공급자 | 온누리문방구 |
| 이용조건 및 이용기간 | 상품 판매 조건에 따라 다름 (결제 안내 페이지 참고) |
| 상품제공방식 | 설치 자동 / 요청 시 설치 (유료 App은 과금 후 설치 진행) |
| 최소 시스템 사양 및 필수 소프트웨어 | 카페24 EC쇼핑몰 솔루션에서 구동됩니다. 웹 기반 상품으로 모바일 환경에서는 일부 기능이 제한될 수 있습니다. |
| 청약철회 | 전자상거래법 17조에 의하여 청약철회가 불가능한 상품입니다. |
| 소비자상담 전화번호 | 010-8555-8219 |
| 주문 후 공급 방법 및 시기 | 설치 요청 당일 제공 (유료 App은 과금 후 당일 제공) / 배송상품 아님 |
| 교환·반품·보증 | 단순 변심 청약철회 불가. 중대한 오류는 전자상거래법 및 소비자분쟁해결기준에 따라 처리 |
| 대금환불 | 전자상거래법에 따라 처리 |
| 분쟁 처리 | 소비자분쟁해결기준(공정거래위원회 고시)에 따라 처리 |
| 거래 약관 | 스토어에 제공된 이용약관 참고 |

### 문의 / 안내 연락처

| 항목 | 값 |
|---|---|
| 방식 | 개별 연락처 사용 (또는 파트너 정보의 고객 상담 연락처) |
| 이메일 | `kwan765@naver.com` |
| 전화 | `010-8555-8219` |

---

## 3. 전자상거래법 고지 (사업자 정보)

`cafe24-quotation-export`·`cafe24-option-detail`에서 확정한 값과 동일(같은 판매자). 다르면 사용자가 수정한다.

| 항목 | 값 |
|---|---|
| 상호 | 온누리문방구 |
| 대표자 | 김기완 |
| 사업자등록번호 | 892-02-03657 |
| 통신판매업신고 | 제2025-경기광명-0525호 |
| 주소 | 경기도 고양시 일산동구 일산로463번길 12, 204동 103호 |
| 이메일 | kwan765@naver.com |
| 전화 | 010-8555-8219 |

---

## 4. 결제 정보

```
무료
```

- 파일럿 단계라 무료로 개방한다. 무료는 "추가 요금 없이 전부 사용" 조건이므로 유료 기능을 넣지 않는다.
- 인앱 결제는 카페24 사전 협의가 필요하므로 선택하지 않는다.

---

## 5. 이 앱을 사용하는 쇼핑몰

**비움.** 등록할 실제 사용 몰이 아직 없다(테스트몰 `onnurimun`은 운영 중인 쇼핑몰이 아님).
파일럿 몰이 생기면 295×166 이미지로 추가한다.

---

## 6. 제출 전 체크리스트

- [ ] 판매 상품명·카테고리·가격(무료) 최종 확정
- [ ] `public/store/detail-01~03.png` 배포 (Vercel)
- [ ] `CAFE24_REDIRECT_URI`와 등록 Redirect URI 일치 재확인
- [ ] 권한에서 상품(Product) 읽기+쓰기, 상점(Store) 읽기만 남기고 나머지 삭제
- [ ] 스크린샷 PC 5장·Mobile 4장 업로드 (1920×1080 / 360×640)
- [ ] 상세설명 HTML에서 `/store/detail-*.png` URL 확인
- [ ] (선택) `/privacy` 개인정보처리방침 추가 후 폼에 URL 입력
- [ ] 테스트몰 `onnurimun` 실측 (품목 단위 전환 후 쓰기→복원)

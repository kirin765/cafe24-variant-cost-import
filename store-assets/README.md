# 스토어 등록용 이미지 · 카피

개발자센터 앱 등록(상품 정보) 화면에 올릴 이미지와 문구. `../cafe24-option-detail`,
`../cafe24-return-photo`의 `store-assets` 규격·렌더링 방식을 재사용했다.

## 아이콘 · 배너

| 파일 | 크기 | 비고 |
|---|---|---|
| `icon-512.png` | 512×512 | 앱 아이콘 원본 |
| `icon-256.png` | 256×256 | `icon-512.png`에서 다운스케일 |
| `icon-100.png` | 100×100 | 등록용 |
| `banner-740x416.png` | 740×416 | 앱 대표설명 |

재생성: `node store-assets/render-icon-banner.mjs` (256·100은 ImageMagick `magick`).
원본은 `store-assets/icon-banner.html` 하나다.

## 상세 설명 이미지 (2x 고해상도)

`detail-images.html` → `public/store/detail-01..03.png` (1240px × 2 = 2480px).
배포하면 `https://cafe24-variant-cost-import.vercel.app/store/detail-0N.png`로 서빙된다.
스토어 HTML에서는 표시 폭 1240px(권장 상한)로 넣는다.

재생성: `node store-assets/render-detail-images.mjs`

## 스크린샷

| 파일 | 크기 | 쓰는 곳 |
|---|---|---|
| `screenshots/pc-01-new.png` | 1920×1080 | 작업 화면 — 몰·scope·공급가 관리 방식·CSV 업로드 |
| `screenshots/pc-02-preview.png` | 1920×1080 | 변경 미리보기 — 요약 + 변경 전·후 공급가 |
| `screenshots/pc-03-errors.png` | 1920×1080 | 오류 차단 — 미매칭·빈 코드·중복 |
| `screenshots/pc-04-run.png` | 1920×1080 | 실행 결과 — 성공·충돌·결과 불명 |
| `screenshots/pc-05-restore.png` | 1920×1080 | 복원 검토 — 복원 가능/충돌 |
| `screenshots/mobile-01-preview.png` | 360×640 | 변경 미리보기 |
| `screenshots/mobile-02-errors.png` | 360×640 | 오류 차단 |
| `screenshots/mobile-03-new.png` | 360×640 | 작업 화면 |
| `screenshots/mobile-04-run.png` | 360×640 | 실행 결과 |

## 문서

- `store-listing-copy.md` — 소개 문구·FAQ·상세 설명(텍스트판)·남은 작업.
- `store-registration-form.md` — 등록 폼 입력값을 항목 순서대로 정리. **미확정 값이 있어 초안 상태.**
- `store-detail.html` — 스토어 상세설명에 붙여넣을 HTML.

## 규격과 전제

- PC 1920×1080(1280×720 @1.5x), 모바일 360×640, 파일당 1MB 미만.
- 스크린샷은 앱 전용 Postgres에 합성 데이터를 심어 실제 앱 화면(`/imports/*`)을 촬영하고,
  끝나면 시드를 지운다. 실제 몰 정보·토큰·원가 원본은 들어가지 않는다.
- **쓰기 활성화(`IMPORT_WRITE_ENABLED=true`) 상태로 서버를 띄워** 확정·실행 버튼이 보이게 캡처한다.
  스크린샷 촬영은 실제 API를 호출하지 않는다(페이지 렌더만).

## 다시 만들기

```bash
npm run db:migrate
npm run build && IMPORT_WRITE_ENABLED=true npx next start -p 3999
BASE_URL=http://127.0.0.1:3999 node store-assets/render-screenshots.mjs
```

상세 이미지·아이콘은 서버 없이 렌더한다.

```bash
node store-assets/render-detail-images.mjs
node store-assets/render-icon-banner.mjs
```

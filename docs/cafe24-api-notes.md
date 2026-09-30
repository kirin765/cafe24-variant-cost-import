# Cafe24 Admin API 조사 기록 (B단계 품목 조회·수정)

- 작성일: 2026-09-17
- 목적: 옵션(품목)별 공급가 조회·수정 구현 전에 공식 문서 근거를 고정한다.
- 상태: 문서 근거 확보. 실제 테스트몰 응답으로 검증 필요(아래 미확인 항목).

## 결론 요약

- 공급가는 **품목(variant) 단위**로 조회·수정할 수 있다. 2026-06-15 배포에서 `supply_price`가
  품목 조회/수정 API에 추가됐다.
- 품목은 상품 하위 리소스다. 상품 목록 조회 결과를 옵션별 품목 목록으로 간주하면 안 된다.
- API 버전은 **헤더** `X-Cafe24-Api-Version`으로 지정한다. 현재 최신은 **2026-09-01**.
- `supply_price`를 받으려면 2026-06-15 이후 버전(예: `2026-06-01`, `2026-09-01`)을 요청해야 한다.

## 엔드포인트

| 동작 | 엔드포인트 | scope | 비고 |
|---|---|---|---|
| 상품 목록 | `GET /api/v2/admin/products` | `mall.read_product` | `limit`/`offset` 페이지네이션. 상품 5,000개 초과 시 `offset` 불가 → `sin_product_no` |
| 상품 단건 | `GET /api/v2/admin/products/{product_no}` | `mall.read_product` | `embed=variants,...` 지원 |
| 품목 목록 | `GET /api/v2/admin/products/{product_no}/variants` | `mall.read_product` | `shop_no`(기본 1), `embed=inventories`. `variants[]` 반환 |
| 품목 단건 | `GET /api/v2/admin/products/{product_no}/variants/{variant_code}` | `mall.read_product` | |
| 품목 수정 | `PUT /api/v2/admin/products/{product_no}/variants` | `mall.write_product` | 한 상품의 여러 품목 동시 수정(요청 한도 1개 상품) |
| 품목 단건 수정 | `PUT /api/v2/admin/products/{product_no}/variants/{variant_code}` | `mall.write_product` | |
| 상품 목록 개수 | `GET /api/v2/admin/products/count` | `mall.read_product` | |

근거(문서):
- 품목 목록: https://developers.cafe24.com/docs-new/en/docs/admin/get-products-by-product-no-variants
- 품목 일괄 수정: https://developers.cafe24.com/docs-new/en/docs/admin/put-products-by-product-no-variants
- 품목 단건 수정: https://developers.cafe24.com/docs-new/en/docs/admin/put-products-by-product-no-variants-by-variant-code
- 상품 목록: https://developers.cafe24.com/docs-new/en/docs/admin/get-products
- API 인덱스(버전 선택): https://developers.cafe24.com/docs/en/api/admin

## API 버전 전달

- 방식: 요청 헤더 `X-Cafe24-Api-Version: {version}` (예: `2026-09-01`).
- 헤더가 없으면 개발자센터 앱 설정의 버전을 따른다.
- 최신 버전: **2026-09-01**. 유효 기간은 최신 버전 배포 후 1년, 만료 시 사용 가능한 가장 오래된 버전으로 대체된다.
- 예시(문서):
  ```
  curl -X GET 'https://{mallid}.cafe24api.com/api/v2/admin/products' \
    -H 'Authorization: Bearer {access_token}' \
    -H 'X-Cafe24-Api-Version: 2026-09-01'
  ```

## supply_price 근거

API changelog(2026-06-15 배포, Improvement):
> 상품 품목별로 공급가액을 수정하고 조회할 수 있도록 API가 개선되었어요.
> 대상 API: `GET/PUT /api/v2/admin/products/{product_no}/variants`, `GET/PUT .../variants/{variant_code}`
> 추가된 파라미터: `supply_price`(공급가액)

근거 URL: https://developers.cafe24.com/api/changelog/front/list (2026-06-15 항목)

## product_no · product_code · variant_code · shop_no 관계

- `product_no`: 시스템 부여 상품 번호(정수 문자열). 쇼핑몰 내 유일. 품목 API의 경로 키.
- `product_code`: 상품코드(예: `P000000T`). Cafe24 **상품목록 내보내기 CSV의 `상품코드`**가 이 값에 해당.
- `variant_code`: 품목코드(예: `P000000R000C`, `[A-Z0-9]` 12자). 품목 API의 경로 키.
- `custom_variant_code`: 자체 품목코드(비어 있을 수 있음). 초기 매칭에는 쓰지 않는다.
- `shop_no`: 멀티쇼핑몰 번호(기본 1). 모든 요청에 전달한다.
- **상품코드와 품목코드는 다른 값이다.** 상품목록 내보내기(`상품코드`·`공급가`)는 상품 단위이므로
  옵션별 품목 공급가 변경의 근거가 될 수 없다. 품목 단위 변경에는 `variant_code`가 있는 파일이 필요하다.
- 옵션: `GET /products/{product_no}/options` → `option.option_name`, `option_value[].option_text`.
  품목 응답의 `options: [{name, value}]`를 표시용 옵션명으로 합쳐 쓴다.

## 금액 제약

- 응답 금액은 문자열(`"0.00"`, `"-1000.00"`)로 온다. KRW 정수 원 단위는 소수점 이하가 0일 때만 정수로
  정규화한다(기존 CSV 규칙과 동일).
- 품목 응답에 `additional_amount`(옵션 추가금액)과 `supply_price`가 별도로 존재한다. 우리는
  `supply_price`만 다루고 `additional_amount`·판매가·재고는 건드리지 않는다.
- 정확한 허용 범위(최대값·음수 여부)는 문서에 명시가 없어 테스트몰에서 확인한다.

## 구현에 반영한 결정

- 조회는 상품 목록(페이지네이션) → 각 상품의 품목 목록 순으로 수행한다. 몰 전체 품목을 한 번에 주는
  엔드포인트는 문서에 없다. 상품 수가 많으면 호출이 선형으로 늘어나므로 상한을 두고 초과 시 경고한다.
- `supply_price`가 없는 품목은 0으로 해석하지 않고 "현재 공급가 없음" 오류로 다룬다.
- API 버전은 `CAFE24_API_VERSION` 환경변수로 넘기고 `X-Cafe24-Api-Version` 헤더로 보낸다. 비우면
  앱 설정 버전을 따른다.
- 상품목록 형식(`상품코드`·`공급가`) CSV는 품목 단위가 아니므로 실제 흐름에서 차단하고 `variant_code`
  형식을 안내한다. `/demo`는 합성 데이터 체험 화면으로 유지한다.

## 쓰기 요청 본문 (가정 — 실제 호출로 확인 필요)

- 단건 수정 `PUT /api/v2/admin/products/{product_no}/variants/{variant_code}` 본문을 다음으로 가정했다:
  ```json
  { "shop_no": 1, "request": { "supply_price": "4500.00" } }
  ```
  근거: Cafe24의 등록/수정 계열은 `{ shop_no, request: {...} }` 형태를 쓴다(예: store setting 수정).
  다만 variants 문서의 요청 스키마는 클라이언트 렌더링이라 본문 예제를 직접 확정하지 못했다.
- 구현은 이 본문을 `src/lib/cafe24/variants.ts`의 `buildVariantSupplyPriceBody`로 만들고, 실제 테스트몰
  호출로 성공/422 여부를 확인해야 한다. 확인 전에는 쓰기를 켜지 않는다(`IMPORT_WRITE_ENABLED` 기본 비활성).

## 실제 테스트몰 결과 (2026-09-18, onnurimun)

읽기:
- `GET /products` 200, 상품 3개. 상품 단위 `supply_price`는 3개 모두 설정됨.
- `GET /products/{no}/variants` 200, 품목 4개. **`supply_price` 키는 4개 모두 반환되지만 값은 전부 `null`**.
- `GET /products/setting` 200. `calculate_price_based_on = "S"`(공급가 기준 판매가 계산).

쓰기 시도(품목 API, `X-Cafe24-Api-Version: 2026-09-01`, 본문 `{ shop_no, request: { supply_price } }`):
- 옵션 없는 단일 품목 상품(예: 상품 10 `P000000J000A`):
  `422 {"error":{"code":422,"message":"Single product cannot be modified.","more_info":{"supply_price":"..."}}}`
- 옵션 있는 상품(예: 상품 15 `P000000P000A`):
  `422 {"error":{"code":422,"message":"Supply price by item cannot be modified.","more_info":{"supply_price":"..."}}}`

해석:
- 요청 본문 형식은 파싱된다(`more_info`에 보낸 `supply_price`가 그대로 반영됨). 즉 **본문 형식 오류가 아니라 의미상 거부**다.
- 이 몰은 공급가 기준(`calculate_price_based_on=S`)으로 판매가를 계산하므로, 2026-06에 추가된 **품목별 공급가 수정/조회
  기능이 이 몰에서는 허용되지 않는 것으로 보인다.** 관리자 UI에도 품목별 공급가 입력란이 없고 상품 단위 공급가만 노출된다.
- 결과적으로 현재 테스트몰에서는 "옵션(품목)별 공급가만 수정"이라는 이 앱의 전제를 실제로 검증할 수 없다.

후속 확인 필요:
- [x] Cafe24 고객센터에 `"Supply price by item cannot be modified."` 조건 문의 → 아래 “2026-09-21 설정 확인” 참고.
- [x] 몰 설정(공급가 관리 방식) 전환 후 재검증 → 아래 참고.
- [ ] 상품 단위 공급가 수정(`PUT /products/{product_no}`)은 판매가 재계산을 유발할 수 있어 별도 검토 없이는 시도하지 않는다.

## 설정 확인·전환 검증 (2026-09-21, onnurimun)

Cafe24 고객센터 답변의 핵심: `supply_price`는 별도 승인 없이 `WRITE_PRODUCT`로 호출 가능하고,
`null`+422는 쇼핑몰의 **‘공급가 관리 방식’이 상품 단위**이기 때문이라는 설명(답변은 추정 표현).
`calculate_price_based_on`과 동일 항목인지는 답변에서 미확정으로 남았다.

관리자 화면에서 직접 확인한 값(`/admin/php/shop1/m/mall_manage_info_f.php`, “상품 판매정보 설정”):

| 화면 항목 | form name | 확인된 값 |
|---|---|---|
| 판매가 계산 기준 설정 | `use_supply_price` | `T`(공급가) — API `calculate_price_based_on=S` |
| 마진율 기준 | `standard_price_type` | `S`(공급가 대비 마진율) |
| 공급가 관리 방식 | `supply_price_mode` | 전환 전 `product`(상품 단위), 전환 후 `variant`(품목 단위) |

→ **`calculate_price_based_on`(판매가 계산 기준)과 ‘공급가 관리 방식’은 서로 다른 필드**다.
‘공급가 관리 방식’은 `GET /products/setting` 응답에 노출되지 않는다(관리자 UI 전용).

전환·재검증 결과:
- 관리자에서 `supply_price_mode=variant`로 저장(확인 대화상자 “공급가 관리 방식을 ‘품목 단위’로
  변경하시겠습니까? · 이전 입력값이 있다면 복원되니 확인해 주세요” → “상점운영방식의 설정이 변경되었습니다.”).
- 전환 후 `PUT /products/15/variants/P000000P000A` `{shop_no, request:{supply_price}}` → **200**,
  쓰기 후 단건 재조회에서 반영 확인, 원복 PUT도 200. (전환 전에는 동일 요청이 422였다.)
- 이로써 422 거부의 직접 원인은 앱 승인/권한/요금제가 아니라 **몰의 ‘공급가 관리 방식’ 설정**임이 확인됐다.
- 옵션 없는 단일 품목 상품(예: 상품 10)은 전환 후에도 품목별 공급가가 `null`이며
  `Single product cannot be modified.` 가 남을 수 있다(별도 취급).

주의(실측): 품목 조회 API는 `Cache: Enabled`라서 **쓰기 직후 재조회가 잠시 이전 값을 돌려줄 수 있다.**
`GET /products/{no}/variants`(목록)와 단건이 서로 다른 시점 값을 보일 수 있으므로 반영 판정은
몇 초 뒤 재조회로 한다.

전환 전 422 응답(X-Trace_ID 포함, 고객센터 재문의용 예):
- `422 {"error":{"code":422,"message":"Supply price by item cannot be modified.","more_info":{"supply_price":"4500.00"}}}`
- 응답 헤더: `x-trace_id: 2b284230da539fb190b67c3a21b3837b` (헤더명은 `X-Trace_ID`)

Cafe24 공식 문서 기준 보강:
- `PUT /products/{product_no}/variants/{variant_code}` 문서는 수정 가능 항목을 “자체 품목 코드,
  진열상태, 판매상태, 추가금액 등”으로만 설명하고 `supply_price`를 나열하지 않는다(한/영 동일).
  Request 스키마는 클라이언트 렌더링이라 본문 필드 목록은 문서만으로 확정할 수 없다.
- 사용자용 안내는 `docs/user-guide.md`에 정리했다.

### 앱 파일럿과 조회 캐시 (2026-09-21)

앱 UI 경로(업로드 → 미리보기 → 확정 → 실행 → 복원)로 2행 배치를 실제 실행했다.
`P000000P000A` 2000→2300(변경), `P000000P000B` 2500(동일) → 실행 완료, 복원으로 A 2300→2000 확인.

이 과정에서 **품목 조회 캐시**가 드러났다. `GET /products/{no}/variants/{code}`는 쓰기 직후 약 5초 동안
이전 값을 돌려주며, 관측값이 `2000 → 2300 → 2000 → 2300 → 2301`처럼 여러 캐시 계층을 오가다 수렴한다.
`cache: no-store` 요청 헤더로도 우회되지 않았다. 그 결과 즉시 재조회만 하면:
- 쓰기 성공을 `not_applied`로 오판하거나,
- 이미 목표값으로 보고 쓰기를 건너뛰어(복원이 무동작) 오판한다.

앱은 쓰기 후 재조회와 ‘이미 목표값’ 확인을 최대 6회·1초 간격으로 재시도해 이 오판을 막는다
(`src/features/imports/executor.ts`). 재시도는 값이 바뀌면 즉시 멈추므로 정상 경로에는 지연이 거의 없다.
캐시를 우회할 API 파라미터는 확인되지 않았다.

## 미확인(테스트몰 검증 필요)

- [ ] `GET /products/{product_no}/variants`가 2026-09-01 버전에서 `supply_price`를 실제로 반환하는지.
- [ ] `supply_price`의 최대값·음수 허용 여부.
- [ ] 품목 응답 `options[]`와 `custom_variant_code`의 실제 값.
- [ ] 상품 5,000개 초과 시 `sin_product_no` 동작과 응답 필드.
- [ ] 단건 수정 `PUT .../variants/{variant_code}` 본문 `{ shop_no, request: { supply_price } }`가 실제로 통하는지(200/422).
- [ ] `PUT /products/{product_no}/variants` 일괄 수정 시 부분 실패 응답 형식(쓰기 단계에서 확인).
- [ ] 쓰기 후 단건 조회에서 `supply_price`가 목표값으로 반영되는지, 다른 필드가 유지되는지.

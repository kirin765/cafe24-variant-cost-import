# 옵션별 공급가 CSV 가져오기 ads plan

Updated: 2026-09-30. Status: **implemented in the working tree; not deployed.** Migration `0004` was applied only to a disposable local Postgres.
Priority: **Later candidate**.

## Implementation status (2026-09-30)

- Card: `src/app/imports/[id]/promo-card.tsx`, rendered after the result table in `src/app/imports/[id]/page.tsx` only when the job is `completed` with at least one success row and **no** `failed`, `conflict`, `unknown` or `pending` rows. Preview, confirmation, execution, partial failure, unknown outcomes, restoration and unavailable-write states never show it. Import/restore behavior was not touched; CSV output has no promotional text.
- Dismiss: 닫기 stores `reviewisa-promo-dismissed:reviewisa_free_apps_20260930` in `localStorage` and logs `reviewisa_promo_dismiss`.
- Tracking: `src/lib/promo-events.ts` + authenticated `POST /api/promo-events` (existing session required; fixed event names; ≤1KB; UUID event id; only mall/shop from the session are stored). `reviewisa_promo_view` fires once per browser session/mall/shop after ≥50% visibility for one second in a visible tab. Table `promo_events` is created by migration `db/migrations/0004_promo_events.sql`.
- Migration: `0004_promo_events.sql` applied and re-run cleanly against a disposable local Postgres 16 (checksum runner reported `0004` applied, second run skipped); a valid promo insert succeeded and an unknown event name was rejected by the CHECK constraint. **Not applied to production.**
- Verification: `npm run lint` ✅, `npm run typecheck` ✅, `npm test` ✅ (185 passed, including DB-backed suites against the local database), `npm run build` ✅, `npm run smoke` ✅ (25/25), `npm run e2e` ✅ (38/38 in a sandboxed copy whose `.env.local` pointed at the disposable local database — the unchanged project `.env.local` targets production, so e2e was intentionally not run in-place).
- Deployment (2026-09-30): `0004_promo_events.sql` applied in production; deployed to https://cafe24-variant-cost-import.vercel.app. Read at the end of the first-trial window (2026-09-30 → 2026-10-14, one readout). This placement's selection gate was explicitly overridden for this coding task by the owner.


## Objective and scope

Reach product operators who may also have Smart Store reviews. Supply-price CSV use is not evidence of review-migration intent. The destination is the paid-option app 리뷰이사; this free app stays free. Audience fit is a hypothesis. Current non-test merchant visits and referral conversion are unmeasured.

This app is one source in the [portfolio strategy](../llm-wiki/reports/cafe24-free-apps-to-reviewisa-2026-09-30.md). Only 옵션별 상세설명 is the proposed first implementation. These files are not nine independently funded experiments.

## Placement

Place one small card below a completed successful import summary on `/imports/[id]`. Require a completed job with successful rows and no unresolved failures or unknown outcomes. Preserve access to details and restoration controls.

Do not show during preview, confirmation, execution, partial failure, unknown outcomes, restoration or authentication errors. Do not include promotional text in CSV files.

The README introduction contains older demo-stage language. Base integration on the current persisted import routes and executor. Never modify import/restore behavior for this promotion.

Implementation reference paths, relative to this project root:

- [src/app/imports/[id]/page.tsx](src/app/imports/[id]/page.tsx)
- [src/features/imports/executor.ts](src/features/imports/executor.ts)

## Copy and destination

> **함께 만든 앱 · 리뷰이사**
>
> **스마트스토어 구매평도 카페24로 옮기시나요?**
>
> 상품별 구매평 엑셀을 올리고, 카페24 상품을 선택해 미리 확인한 뒤 상품후기 게시판에 등록하세요.
>
> **리뷰이사 기능·요금 보기 ↗**
>
> 별도 앱 · 유료 이용 월 9,900원 · 무료 제공 및 결제 조건은 앱스토어에서 확인

Destination: https://store.cafe24.com/kr/apps/43542

The September 30 listing displays ₩9,900/month and initial free-use terms; the review app also has a separate unpaid daily quota. Recheck displayed pricing when implementing and do not promise perpetual or unlimited free use. Avoid automatic product matching, automatic synchronization, guaranteed photo display or sales-lift claims. Do not copy the source app's free label onto 리뷰이사.

## Presentation behavior

- One static, secondary recommendation. No popup, carousel, compulsory step or app-to-app navigation loop.
- Preserve the current task and unsaved work. Open the store link in a separate tab with an ordinary accessible anchor, a new-tab indication and `rel="noopener"`.
- Card placements include an accessible dismiss button, with browser-local dismissal for this campaign. A quiet footer link can remain without a modal or additional UI.
- No ad in the storefront, exported documents or customer messages. No additional Cafe24 permissions just to infer migration needs.
- No shared login, coupon system, ad server or centralized customer database for this trial.

## Measurement

Execution rows and import results are operational records, not ad impressions. Use a separate narrow event collection path if this app is selected later; do not count job completion as card visibility.

Proposed event names are `reviewisa_promo_view`, `reviewisa_promo_click` and, for a dismissible card, `reviewisa_promo_dismiss`. Campaign: `reviewisa_free_apps_20260930`; source: `cafe24-variant-cost-import`. These are specifications, not existing implemented events. Fix campaign/source in the app or validated schema; do not send raw merchant identifiers in public links or third-party analytics.

Count exposure only after at least 50% of the recommendation is visible for one second in an active tab. Deduplicate views and clicks by authenticated mall/shop across the observation window, excluding known test/developer malls and demos. If authenticated identity is unavailable, report browser/event counts separately and leave unique merchant counts unmeasured. Logging failure must not block the normal link or the app's work.

Show eligible merchants, exposed merchants E, clicking merchants C and C/E with raw counts. A page open is not exposure; a click is not installation, completed migration or payment. Investigate missing visibility events instead of forcing a complete funnel.

Cafe24 marketplace links currently have no verified end-to-end campaign attribution. UTM alone does not join installation/payment records. Record explicitly source-confirmed use and payments separately; unknown attribution stays unknown. Do not contact customers automatically.

## Budget and next decision

The **first portfolio trial** has a proposed total cap of 2 implementation/verification hours, no additional cash, 14 calendar days of observation and 30 minutes of readout. This is not a per-app allowance. Before implementation, record the selected source, actual start date, end date and owner in the ledger. Proposed ownership is Codex for implementation/readout and Giwan for investment decisions. No schedule is active.

Apply the following learning rules at the recorded end date:

- Missing telemetry or E=0: distinguish measurement/execution from no exposure; no offer verdict.
- E<30 with no clicks: inconclusive. Stop experiment work; do not automatically extend.
- E>=30 with no clicks: stop optimizing this placement/copy combination. This is a spending rule, not proof that all cross-promotion fails.
- One or two clicking merchants without confirmed use: weak interest; no rollout budget yet.
- At least three clicking merchants, or one source-confirmed completed migration: supports at most one newly scoped two-hour test of attribution or another source app.
- One source-confirmed new payer: evaluate receipts after fees and incremental support before adding up to two more sources. Do not assume renewal or causality from a monthly billing label.

For deferred apps, wait for that selection decision; a plan file does not change the priority or revive an archived product bet. Existing review-app gate/kill rules stay unchanged. A harmless link may remain after readout, but ongoing optimization requires a new bounded commitment.

## Implementation checklist when selected

- Read local AGENTS.md and the installed framework documentation required by it; preserve current working-tree changes.
- Confirm the proposed surface and displayed offer still match the app; implement only that surface.
- Verify real/demo/error visibility, link destination, dismissal where applicable and preservation of the core workflow.
- Verify event acceptance, visibility timing, deduplication, test exclusions and failure-tolerant navigation; use the project's required checks for the actual change.
- Record deployment date and observation end date; conduct one bounded readout, not an unattended recurring loop.

No app code, deployment, pricing or external messaging is authorized merely by this planning document. The current task writes plans only.

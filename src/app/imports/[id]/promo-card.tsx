"use client";

import { useEffect, useRef, useState } from "react";

const STORE_URL = "https://store.cafe24.com/kr/apps/43542";
const SOURCE = "cafe24-variant-cost-import";
const CAMPAIGN = "reviewisa_free_apps_20260930";
const DISMISS_KEY = `reviewisa-promo-dismissed:${CAMPAIGN}`;
const VIEW_KEY = `reviewisa-promo-viewed:${CAMPAIGN}:${SOURCE}`;

type PromoEventName = "reviewisa_promo_view" | "reviewisa_promo_click" | "reviewisa_promo_dismiss";

/** Ordinary navigation is never blocked by telemetry; failures stay silent. */
function sendPromoEvent(eventName: PromoEventName) {
  try {
    void fetch("/api/promo-events", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: crypto.randomUUID(), eventName }),
      keepalive: true,
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {
    // Unsupported browser APIs or a blocked request must not break the page.
  }
}

/**
 * One static secondary recommendation below a completed successful import summary.
 * Exposure counts only at ≥50% visible for one second in an active tab.
 */
export function PromoCard({ mallId, shopNo }: { mallId: string; shopNo: string }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (dismissed) return;
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sent = false;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (sent) return;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            timer ??= setTimeout(() => {
              timer = null;
              if (document.visibilityState !== "visible") return;
              sent = true;
              try {
                const key = `${VIEW_KEY}:${mallId}:${shopNo}`;
                if (sessionStorage.getItem(key) === "1") return;
                sessionStorage.setItem(key, "1");
              } catch {
                // Storage unavailable: still send one exposure for this mount.
              }
              sendPromoEvent("reviewisa_promo_view");
            }, 1000);
          } else {
            clear();
          }
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => {
      clear();
      observer.disconnect();
    };
  }, [dismissed, mallId, shopNo]);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Dismissal is per browser when storage is available.
    }
    sendPromoEvent("reviewisa_promo_dismiss");
  };

  return (
    <aside
      ref={cardRef}
      aria-label="리뷰이사 추천"
      className="mt-6 rounded border border-neutral-200 bg-neutral-50 p-4 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-neutral-500">함께 만든 앱 · 리뷰이사</p>
          <p className="mt-1 font-semibold text-neutral-900">
            스마트스토어 구매평도 카페24로 옮기시나요?
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            상품별 구매평 엑셀을 올리고, 카페24 상품을 선택해 미리 확인한 뒤 상품후기 게시판에
            등록하세요.
          </p>
          <a
            href={STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs font-semibold text-neutral-900 underline"
            onClick={() => sendPromoEvent("reviewisa_promo_click")}
          >
            리뷰이사 기능·요금 보기 ↗
            <span className="sr-only"> (새 탭에서 열립니다)</span>
          </a>
          <p className="mt-1 text-[11px] text-neutral-500">
            별도 앱 · 유료 이용 월 9,900원 · 무료 제공 및 결제 조건은 앱스토어에서 확인
          </p>
        </div>
        <button
          type="button"
          aria-label="리뷰이사 추천 닫기"
          onClick={dismiss}
          className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-600"
        >
          닫기
        </button>
      </div>
    </aside>
  );
}

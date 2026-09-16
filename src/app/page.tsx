import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cafe24 옵션별 공급가 가져오기 — 로컬 데모",
  description: "합성 품목 목록과 공급가 CSV를 매칭·검증하고 변경 명세를 확인하는 데모입니다.",
};

const STEPS = [
  "대상 몰과 공급가 CSV(합성 파일 또는 직접 올린 파일)를 고릅니다.",
  "플랫폼 품목 코드를 정확히 매칭해 변경 전/후 공급가를 계산합니다.",
  "중복·미매칭·잘못된 숫자를 오류로 표시하고 확정을 차단합니다.",
  "검토 결과와 변경 명세를 파일로 내보냅니다.",
];

const RULES = [
  "품목 코드 앞자리 0과 문자열을 그대로 보존합니다. 내부 공백·문자 변형은 자동 교정하지 않습니다.",
  "빈 공급가는 0으로 해석하지 않습니다. 0원은 명시적 입력으로 허용하되 눈에 띄게 표시합니다.",
  "파일 안 동일 코드 중복은 값이 같아도 오류입니다.",
  "음수·NaN·통화 기호·모호한 천 단위 표기·소수·지수 표기는 오류입니다.",
];

const NOT_INCLUDED = [
  "Cafe24 OAuth·실제 품목/옵션 API 호출, 실제 공급가 쓰기",
  "판매가·할인·재고·공급가 관리 설정 변경",
  "상품명 유사도 기반 자동 매칭, 공급사 파일 전 형식 자동 해석",
  "예약·반복 실행, 외부 ERP 양방향 동기화",
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-xs font-semibold tracking-widest text-neutral-500">
        CAFE24 VARIANT COST IMPORT
      </p>
      <h1 className="mt-2 text-2xl font-bold">옵션별 공급가 CSV 가져오기 — 로컬 데모</h1>
      <p className="mt-3 text-sm leading-relaxed text-neutral-700">
        공급사 원가표(CSV)를 Cafe24 품목에 매칭하고 변경점을 검토한 뒤 옵션별 공급가만 바꾸는
        작업의 데모입니다. 서버·DB·Cafe24 연동 없이 합성 데이터로만 동작하며, 실제 품목 값은
        수정하지 않습니다.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
          href="/demo"
        >
          데모 열기
        </Link>
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-bold">사용 흐름</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold">매칭·검증 규칙</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-700">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded border border-amber-300 bg-amber-50 p-4">
        <h2 className="text-sm font-bold text-amber-900">이 데모에 없는 것</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
          {NOT_INCLUDED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-amber-900">
          데모 완성은 수요 검증이 아닙니다. 실제 API 쓰기·읽기 제약은 아직 확인하지 않았습니다.
        </p>
      </section>
    </main>
  );
}

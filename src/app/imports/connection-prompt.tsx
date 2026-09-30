import Link from "next/link";

export function ReconnectPrompt({ mallId, message }: { mallId: string | null; message: string }) {
  const launchHref = mallId ? `/api/cafe24/launch?mall_id=${encodeURIComponent(mallId)}` : "/";
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-xs font-semibold tracking-widest text-neutral-500">CAFE24 CONNECT</p>
      <h1 className="mt-1 text-xl font-bold">Cafe24 연결이 필요합니다</h1>
      <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        {message}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
          href={launchHref}
        >
          {mallId ? `${mallId} 다시 연결` : "Cafe24 앱 다시 실행"}
        </Link>
        <Link
          className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700"
          href="/demo"
        >
          데모 보기
        </Link>
      </div>
      <p className="mt-4 text-xs text-neutral-500">
        연결은 Cafe24 관리자에서 앱을 실행하거나 위 버튼으로 OAuth를 다시 시작해 만들 수 있습니다.
      </p>
    </main>
  );
}

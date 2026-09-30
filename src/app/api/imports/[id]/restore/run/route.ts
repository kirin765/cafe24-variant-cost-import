import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { runRestoreJob } from "@/features/imports/runner";
import { buildRunnerContext } from "@/features/imports/runner-context";
import { getRestoreJob } from "@/features/imports/store";
import { getCurrentSession } from "@/lib/cafe24/auth";
import { isWriteEnabled } from "@/lib/cafe24/env";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const form = await request.formData().catch(() => null);
  const restoreJobId = typeof form?.get("rid") === "string" ? String(form.get("rid")) : "";
  const back = (query: string) =>
    NextResponse.redirect(
      new URL(`/imports/${id}/restore?rid=${restoreJobId}&${query}`, request.url),
      303,
    );

  if (!hasDatabaseUrl()) return back("error=storage");
  const access = await getCurrentSession();
  if (!access) return NextResponse.redirect(new URL("/imports/new", request.url), 303);
  if (!isWriteEnabled()) return back("error=write_disabled");
  if (!restoreJobId) return NextResponse.redirect(new URL(`/imports/${id}`, request.url), 303);

  const pool = getPool();
  const restoreJob = await getRestoreJob(pool, restoreJobId, access.shop.id);
  if (!restoreJob || restoreJob.sourceJobId !== id) return back("error=not_found");

  const runner = buildRunnerContext(access.shop, `restore-run:${randomUUID()}`);
  if (!runner) return back("error=config");

  const result = await runRestoreJob(runner, restoreJobId);
  return back(`run=${result.status}`);
}

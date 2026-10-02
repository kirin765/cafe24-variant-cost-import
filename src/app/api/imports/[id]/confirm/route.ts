import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/cafe24/auth";
import { isWriteEnabled } from "@/lib/cafe24/env";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";
import { relativeRedirect } from "@/lib/http";
import { confirmImportJob, getImportJob } from "@/features/imports/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const back = (query: string) => relativeRedirect(`/imports/${id}?${query}`, 303);

  if (!hasDatabaseUrl()) return back("error=storage");
  const access = await getCurrentSession();
  if (!access) return relativeRedirect("/imports/new", 303);
  if (!isWriteEnabled()) return back("error=write_disabled");

  const pool = getPool();
  const job = await getImportJob(pool, id, access.shop.id);
  if (!job) return back("error=not_found");
  if (job.blocked) return back("error=blocked");

  const ok = await confirmImportJob(pool, id, access.shop.id, {
    fileHash: job.fileHash,
    previewVersion: job.previewVersion,
  });
  return back(ok ? "confirmed=1" : "error=confirm_failed");
}

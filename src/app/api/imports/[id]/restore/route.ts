import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { planRestore } from "@/features/imports/restore";
import { createRunnerWriter } from "@/features/imports/runner";
import { buildRunnerContext } from "@/features/imports/runner-context";
import {
  createRestoreJob,
  getImportJob,
  listRestoreSourceRows,
} from "@/features/imports/store";
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
  const back = (query: string) =>
    NextResponse.redirect(new URL(`/imports/${id}?${query}`, request.url), 303);

  if (!hasDatabaseUrl()) return back("error=storage");
  const access = await getCurrentSession();
  if (!access) return NextResponse.redirect(new URL("/imports/new", request.url), 303);
  if (!isWriteEnabled()) return back("error=write_disabled");

  const pool = getPool();
  const job = await getImportJob(pool, id, access.shop.id);
  if (!job) return back("error=not_found");

  const sourceRows = await listRestoreSourceRows(pool, id);
  if (sourceRows.length === 0) return back("error=no_success");

  const runner = buildRunnerContext(access.shop, `restore-preview:${randomUUID()}`);
  if (!runner) return back("error=config");
  const writer = await createRunnerWriter(runner);
  if (!writer) return back("error=reauth");

  const currents = new Map<string, number | null>();
  for (const row of sourceRows) {
    try {
      currents.set(
        row.rowId,
        row.productNo ? await writer.read(row.productNo, row.variantCode) : null,
      );
    } catch {
      currents.set(row.rowId, null);
    }
  }

  const plan = planRestore(sourceRows, currents);
  const restoreJobId = await createRestoreJob(pool, {
    sourceJobId: id,
    shopId: access.shop.id,
    rows: plan,
  });
  return NextResponse.redirect(
    new URL(`/imports/${id}/restore?rid=${restoreJobId}`, request.url),
    303,
  );
}

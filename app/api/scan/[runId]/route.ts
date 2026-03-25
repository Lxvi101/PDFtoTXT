import { NextRequest, NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk";
import { getToken } from "@/lib/auth-server";
import { api, getAuthenticatedConvexClient } from "@/lib/convex";
import type { ProcessPdfOutput, ProgressMetadata } from "@/trigger/process-pdf";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId");
  const pageCount = parseInt(url.searchParams.get("pageCount") || "0", 10);
  const recordUsage = url.searchParams.get("recordUsage") === "1";

  try {
    const run = await runs.retrieve(runId);

    // Map Trigger.dev status → simple frontend status
    let status: "queued" | "processing" | "completed" | "failed";
    switch (run.status) {
      case "COMPLETED":
        status = "completed";
        break;
      case "FAILED":
      case "SYSTEM_FAILURE":
      case "CRASHED":
      case "CANCELED":
      case "TIMED_OUT":
        status = "failed";
        break;
      case "EXECUTING":
      case "WAITING":
        status = "processing";
        break;
      default:
        status = "queued";
    }

    const output = run.output as ProcessPdfOutput | undefined;
    const progress = (run.metadata as Record<string, unknown> | null)?.progress as
      | ProgressMetadata
      | undefined;

    const convex = getAuthenticatedConvexClient(token);

    const markScanRunComplete = async () => {
      if (status === "failed") {
        try {
          await convex.mutation(api.scanRuns.complete, {
            triggerRunId: runId,
            status: "failed",
          });
        } catch {
          // idempotent
        }
        return;
      }
      if (status === "completed" && output) {
        const terminalStatus = output.summary.stoppedEarly ? ("stopped" as const) : ("completed" as const);
        try {
          await convex.mutation(api.scanRuns.complete, {
            triggerRunId: runId,
            status: terminalStatus,
            successCount: output.summary.successCount,
            failedCount: output.summary.failedCount,
            stoppedEarly: output.summary.stoppedEarly,
          });
        } catch {
          // idempotent
        }
      }
    };

    // ── Refund: entire run failed (Trigger.dev infra issue / timeout) ──
    if (status === "failed" && requestId && pageCount > 0) {
      try {
        await convex.mutation(api.credits.refund, {
          amount: pageCount,
          reason: "scan_run_failed",
          requestId,
        });
      } catch {
        // Already refunded or other issue — safe to ignore
      }
    }

    // ── Refund: run completed but some pages failed after all retries ──
    if (status === "completed" && output?.summary.failedCount && requestId) {
      try {
        await convex.mutation(api.credits.refund, {
          amount: output.summary.failedCount,
          reason: "scan_pages_failed",
          requestId: `${requestId}_partial`,
        });
      } catch {
        // Already refunded
      }
    }

    // ── Refund: run completed but stopped early (circuit breaker) ──
    if (status === "completed" && output?.summary.stoppedEarly && requestId) {
      // Count pages that were never attempted (still "pending" in the statuses)
      const pendingCount = progress
        ? Object.values(progress.pageStatuses).filter((s) => s === "pending").length
        : 0;
      if (pendingCount > 0) {
        try {
          await convex.mutation(api.credits.refund, {
            amount: pendingCount,
            reason: "scan_stopped_early",
            requestId: `${requestId}_unattempted`,
          });
        } catch {
          // Already refunded
        }
      }
    }

    // ── Record usage for successful pages (once) ──
    if (status === "completed" && output && recordUsage) {
      try {
        for (const page of output.pages.filter((p) => p.status === "success")) {
          await convex.mutation(api.usage.record, {
            pageNumber: page.pageNumber,
            inputTokens: page.inputTokens,
            outputTokens: page.outputTokens,
            cost: page.cost,
          });
        }
      } catch (usageError) {
        console.warn("Usage recording failed:", usageError);
      }
    }

    if (status === "failed" || (status === "completed" && output)) {
      await markScanRunComplete();
    }

    return NextResponse.json({
      status,
      output: output ?? null,
      progress: progress ?? null,
      createdAt: run.createdAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("Poll error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve run status" },
      { status: 500 },
    );
  }
}

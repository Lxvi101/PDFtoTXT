import { NextRequest, NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import { getToken } from "@/lib/auth-server";
import { api, getAuthenticatedConvexClient } from "@/lib/convex";
import { PDFDocument } from "pdf-lib";
import type { processPdf } from "@/trigger/process-pdf";

export async function POST(request: NextRequest) {
  try {
    const token = await getToken();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const convex = getAuthenticatedConvexClient(token);
    const user = await convex.mutation(api.users.ensureUser, {});
    const isAdmin = !!user?.isAdmin;

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("pdf") as File | null;
    const pageStartRaw = formData.get("pageStart") as string | null;
    const pageEndRaw = formData.get("pageEnd") as string | null;

    if (!file || file.type !== "application/pdf") {
      return NextResponse.json({ error: "A valid PDF file is required" }, { status: 400 });
    }

    // 20 MB limit (Trigger.dev payload cap)
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "PDF must be under 20 MB" },
        { status: 413 },
      );
    }

    // Count pages with pdf-lib
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const totalPages = pdfDoc.getPageCount();

    const parsedStart = parseInt(pageStartRaw || "", 10);
    const parsedEnd = parseInt(pageEndRaw || "", 10);
    const pageStart = isNaN(parsedStart) ? 1 : Math.max(1, parsedStart);
    const pageEnd = isNaN(parsedEnd) ? totalPages : Math.min(parsedEnd, totalPages);
    const pageCount = pageEnd - pageStart + 1;

    if (pageCount <= 0) {
      return NextResponse.json({ error: "Invalid page range" }, { status: 400 });
    }

    // Deduct credits upfront (1 credit per page)
    const requestId = crypto.randomUUID();
    let creditsRemaining = user?.credits ?? 0;

    if (!isAdmin) {
      try {
        const spendResult = await convex.mutation(api.credits.spend, {
          amount: pageCount,
          reason: "scan_pdf",
          requestId,
        });
        creditsRemaining = spendResult.credits;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("INSUFFICIENT_CREDITS")) {
          return NextResponse.json(
            { error: "Insufficient credits", required: pageCount, available: user?.credits },
            { status: 402 },
          );
        }
        return NextResponse.json({ error: "Unable to reserve credits" }, { status: 500 });
      }
    }

    // Encode PDF and trigger the cloud task
    const pdfBase64 = Buffer.from(arrayBuffer).toString("base64");

    const handle = await tasks.trigger<typeof processPdf>("process-pdf", {
      pdfBase64,
      pageStart,
      pageEnd,
      totalPages,
    });

    try {
      await convex.mutation(api.scanRuns.create, {
        triggerRunId: handle.id,
        requestId,
        pageCount,
        pageStart,
        pageEnd,
        totalPages,
      });
    } catch (e) {
      console.error("scanRuns.create failed:", e);
    }

    return NextResponse.json({
      runId: handle.id,
      pageCount,
      pageStart,
      pageEnd,
      totalPages,
      creditsRemaining,
      requestId,
    });
  } catch (error) {
    console.error("Scan trigger error:", error);
    return NextResponse.json({ error: "Failed to start scan" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import { getToken } from "@/lib/auth-server";
import { api, getAuthenticatedConvexClient } from "@/lib/convex";
import { PDFDocument } from "pdf-lib";
import type { processPdf } from "@/trigger/process-pdf";

const MAX_SCAN_PDF_BYTES = 20 * 1024 * 1024;

type ScanRequestBody = {
  blobUrl?: unknown;
  pageStart?: unknown;
  pageEnd?: unknown;
};

const parseOptionalInteger = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
};

const SCAN_PATH_PREFIX = "/scan-pdfs/";

const isAllowedBlobUrl = (value: string) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      host.endsWith(".blob.vercel-storage.com") &&
      url.pathname.startsWith(SCAN_PATH_PREFIX)
    );
  } catch {
    return false;
  }
};

export async function POST(request: NextRequest) {
  try {
    const token = await getToken();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const convex = getAuthenticatedConvexClient(token);
    const user = await convex.mutation(api.users.ensureUser, {});
    const isAdmin = !!user?.isAdmin;

    const body = (await request.json().catch(() => null)) as ScanRequestBody | null;
    const pdfBlobUrl = typeof body?.blobUrl === "string" ? body.blobUrl : "";
    const pageStartRaw = body?.pageStart;
    const pageEndRaw = body?.pageEnd;

    if (!pdfBlobUrl || !isAllowedBlobUrl(pdfBlobUrl)) {
      return NextResponse.json({ error: "A valid PDF blob URL is required" }, { status: 400 });
    }

    const pdfResponse = await fetch(pdfBlobUrl);
    if (!pdfResponse.ok) {
      return NextResponse.json({ error: "Unable to read uploaded PDF" }, { status: 400 });
    }

    const contentType = pdfResponse.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/pdf")) {
      return NextResponse.json({ error: "Uploaded file must be a PDF" }, { status: 400 });
    }

    const arrayBuffer = await pdfResponse.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_SCAN_PDF_BYTES) {
      return NextResponse.json(
        { error: "PDF must be under 20 MB" },
        { status: 413 },
      );
    }

    // Count pages with pdf-lib for trusted credit/page validation
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const totalPages = pdfDoc.getPageCount();

    const parsedStart = parseOptionalInteger(pageStartRaw);
    const parsedEnd = parseOptionalInteger(pageEndRaw);
    const pageStart = parsedStart === undefined ? 1 : Math.max(1, parsedStart);
    const pageEnd = parsedEnd === undefined ? totalPages : Math.min(parsedEnd, totalPages);
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

    const handle = await tasks.trigger<typeof processPdf>("process-pdf", {
      pdfBlobUrl,
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

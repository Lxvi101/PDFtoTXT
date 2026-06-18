import { NextRequest, NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk";
import { get, put } from "@vercel/blob";
import { getToken } from "@/lib/auth-server";
import { api, getAuthenticatedConvexClient } from "@/lib/convex";
import type { ProcessPdfOutput } from "@/trigger/process-pdf";

type DashboardRun = {
  triggerRunId: string;
  fileName?: string;
  output?: {
    markdownBlobPath?: string;
    summary?: ProcessPdfOutput["summary"];
    pages?: ProcessPdfOutput["pages"];
  };
};

type DashboardRuns = {
  active?: DashboardRun[];
  recent?: DashboardRun[];
};

const markdownBlobPath = (runId: string) => `scan-markdown/${runId}.md`;

const sanitizeFilename = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120);

const buildMarkdown = (runId: string, fileName: string | undefined, output: ProcessPdfOutput) => {
  const successPages = output.pages.filter((page) => page.status === "success" && page.text?.trim());
  const failedPages = output.pages.filter((page) => page.status === "error");

  if (successPages.length === 0) return null;

  const parts = [
    `# ${fileName || `Scan ${runId}`}`,
    "",
    `Run: \`${runId}\``,
    `Successful pages: ${successPages.length}`,
    failedPages.length ? `Failed pages: ${failedPages.length}` : "",
    "",
  ].filter(Boolean);

  for (const page of successPages) {
    parts.push(`## Page ${page.pageNumber}`, "", page.text || "", "");
  }

  if (failedPages.length > 0) {
    parts.push("## Failed Pages", "");
    for (const page of failedPages) {
      parts.push(`- Page ${page.pageNumber}: ${page.error || "No error message was recorded."}`);
    }
    parts.push("");
  }

  return parts.join("\n").replace(/\n{4,}/g, "\n\n\n");
};

const readMarkdownBlob = async (path: string) => {
  const blob = await get(path, { access: "private", useCache: false }).catch(() => null);
  if (!blob?.stream) return null;
  return await new Response(blob.stream).text();
};

const writeMarkdownBlob = async (runId: string, markdown: string) => {
  await put(markdownBlobPath(runId), markdown, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/markdown; charset=utf-8",
    cacheControlMaxAge: 60,
  });
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;
  const convex = getAuthenticatedConvexClient(token);

  try {
    const scanRuns = (await convex.query(api.scanRuns.listForDashboard, {})) as DashboardRuns;
    const run = [...(scanRuns.active ?? []), ...(scanRuns.recent ?? [])].find(
      (item) => item.triggerRunId === runId,
    );

    if (!run) {
      return NextResponse.json(
        {
          error: "Run not found",
          detail: "This run is not available in your recent scan history.",
        },
        { status: 404 },
      );
    }

    const path = run.output?.markdownBlobPath || markdownBlobPath(runId);
    let markdown = await readMarkdownBlob(path);

    if (!markdown) {
      const storedOutput =
        run.output?.summary && run.output.pages?.length
          ? {
              summary: run.output.summary,
              pages: run.output.pages,
            }
          : null;
      markdown = storedOutput ? buildMarkdown(runId, run.fileName, storedOutput) : null;
    }

    if (!markdown) {
      const triggerRun = await runs.retrieve(runId);
      const output = triggerRun.output as ProcessPdfOutput | undefined;
      markdown = output ? buildMarkdown(runId, run.fileName, output) : null;

      if (markdown) {
        await writeMarkdownBlob(runId, markdown);
      }
    }

    if (!markdown) {
      return NextResponse.json(
        {
          error: "Markdown unavailable",
          detail:
            "No markdown artifact exists for this run, and Trigger did not return recoverable page output. The run may have completed before durable markdown artifact storage was added.",
        },
        { status: 404 },
      );
    }

    const fileName = sanitizeFilename(run.fileName || runId).replace(/\.pdf$/i, "");
    return new NextResponse(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName || runId}.md"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Markdown download failed:", error);
    return NextResponse.json(
      {
        error: "Markdown download failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

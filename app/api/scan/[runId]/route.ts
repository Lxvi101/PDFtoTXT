import { NextRequest, NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk";
import { put } from "@vercel/blob";
import { getToken } from "@/lib/auth-server";
import { api, getAuthenticatedConvexClient } from "@/lib/convex";
import type { ProcessPdfOutput, ProgressMetadata } from "@/trigger/process-pdf";

const terminalFailureStatuses = new Set([
  "FAILED",
  "SYSTEM_FAILURE",
  "CRASHED",
  "CANCELED",
  "TIMED_OUT",
]);

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; name?: unknown; stackTrace?: unknown; stack?: unknown };
    return {
      message:
        typeof maybe.message === "string"
          ? maybe.message
          : JSON.stringify(error),
      name: typeof maybe.name === "string" ? maybe.name : undefined,
      stack:
        typeof maybe.stackTrace === "string"
          ? maybe.stackTrace
          : typeof maybe.stack === "string"
            ? maybe.stack
            : undefined,
    };
  }

  return {
    message: typeof error === "string" ? error : "Unknown error",
    name: undefined,
    stack: undefined,
  };
};

const markdownBlobPath = (runId: string) => `scan-markdown/${runId}.md`;

const buildMarkdown = (runId: string, output: ProcessPdfOutput) => {
  const successPages = output.pages.filter((page) => page.status === "success" && page.text?.trim());
  const failedPages = output.pages.filter((page) => page.status === "error");
  const parts = [
    `# Scan ${runId}`,
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

const persistMarkdownArtifact = async (runId: string, output: ProcessPdfOutput) => {
  const markdown = buildMarkdown(runId, output);
  if (!markdown.trim()) return null;

  const blob = await put(markdownBlobPath(runId), markdown, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/markdown; charset=utf-8",
    cacheControlMaxAge: 60,
  });

  return blob.url;
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
    const error = serializeError(run.error);

    if (status === "failed" || (status === "completed" && output)) {
      const markdownBlobUrl = output ? await persistMarkdownArtifact(runId, output) : null;

      const terminalStatus =
        status === "failed"
          ? ("failed" as const)
          : output?.summary.stoppedEarly
            ? ("stopped" as const)
            : ("completed" as const);
      await convex.mutation(api.scanRuns.finalize, {
        triggerRunId: runId,
        status: terminalStatus,
        output: output
          ? {
              summary: output.summary,
              markdownBlobPath: markdownBlobPath(runId),
              markdownBlobUrl,
            }
          : undefined,
        progress,
        errorMessage: status === "failed" ? error.message : undefined,
        errorName: status === "failed" ? error.name : undefined,
        errorStack: status === "failed" ? error.stack : undefined,
        triggerStatus: run.status,
      });
    } else {
      await convex.mutation(api.scanRuns.sync, {
        triggerRunId: runId,
        triggerStatus: run.status,
        progress,
        output,
        errorMessage:
          terminalFailureStatuses.has(run.status) && error.message
            ? error.message
            : undefined,
        errorName: error.name,
        errorStack: error.stack,
      });
    }

    return NextResponse.json({
      status,
      triggerStatus: run.status,
      output: output ?? null,
      progress: progress ?? null,
      error: status === "failed" ? error : null,
      createdAt: run.createdAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    });
  } catch (error) {
    const serialized = serializeError(error);
    console.error("Poll error:", serialized);
    try {
      await convex.mutation(api.scanRuns.notePollError, {
        triggerRunId: runId,
        errorMessage: serialized.message,
        errorName: serialized.name,
        errorStack: serialized.stack,
      });
    } catch (convexError) {
      console.error("Failed to persist poll error:", convexError);
    }
    return NextResponse.json(
      {
        error: "Failed to retrieve run status",
        detail: serialized.message,
        name: serialized.name,
      },
      { status: 500 },
    );
  }
}

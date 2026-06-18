import type { DeserializedJson } from "@trigger.dev/core";
import { task, logger, metadata, queue } from "@trigger.dev/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PDFDocument } from "pdf-lib";
import { get, put } from "@vercel/blob";

// ── OCR prompt ──────────────────────────────────────────────────────
const OCR_PROMPT = `
System Instruction: You are a specialized OCR and document parsing engine. Task: Analyze the provided image of a document. Output Requirements:

No Conversational Text: Do not include any introductory remarks, explanations, or concluding statements. Output only the extracted content.

Text Extraction: Extract all visible text exactly as written.

Tabular Data: Represent all tables using clean Markdown table syntax.

Mathematical Notation: If the document contains complex formulas or equations, represent them using LaTeX within standard delimiters (e.g., $ ... $ or $$...$$).

Graphics & Visuals: If the document contains images, charts, or diagrams, provide a detailed description within a Markdown blockquote using the following format:

[GRAPHIC DESCRIPTION]: [Insert a comprehensive, detailed explanation of what the graphic shows here]

Formatting: Use Markdown headers and lists to mirror the document's original structure.
`.trim();

// ── Pricing constants ───────────────────────────────────────────────
const PRICING = { INPUT_PER_1M: 0.5, OUTPUT_PER_1M: 3.0 };

const calculateCost = (input: number, output: number) =>
  (input / 1_000_000) * PRICING.INPUT_PER_1M +
  (output / 1_000_000) * PRICING.OUTPUT_PER_1M;

const GEMINI_MODEL = "gemini-3.1-flash-lite";
const MAX_ERROR_LENGTH = 600;

function formatRunError(error: unknown) {
  let message = "unknown error";

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.length > 0) {
      message = maybeMessage;
    } else {
      try {
        message = JSON.stringify(error);
      } catch {
        message = String(error);
      }
    }
  } else if (error !== undefined && error !== null) {
    message = String(error);
  }

  return message.length > MAX_ERROR_LENGTH
    ? `${message.slice(0, MAX_ERROR_LENGTH)}...`
    : message;
}

function getRunErrorMessage(run: unknown) {
  if (run && typeof run === "object" && "error" in run) {
    return formatRunError((run as { error?: unknown }).error);
  }

  return "unknown error";
}

// ── Types ───────────────────────────────────────────────────────────
export interface PageResult {
  pageNumber: number;
  text: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  status: "success" | "error";
  error?: string;
}

export interface ProgressMetadata {
  phase: "splitting" | "processing" | "retrying" | "done" | "stopped";
  totalPages: number;
  completedCount: number;
  failedCount: number;
  retryAttempt: number;
  /** Per-page status map: { "1": "success", "5": "error", "6": "pending" } */
  pageStatuses: Record<string, "success" | "error" | "pending" | "processing">;
  stoppedReason?: string;
}

export interface ProcessPdfOutput {
  pages: PageResult[];
  summary: {
    totalPages: number;
    successCount: number;
    failedCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    stoppedEarly: boolean;
    stoppedReason?: string;
    markdownBlobPath?: string;
    markdownBlobUrl?: string;
  };
}

// ── Constants ───────────────────────────────────────────────────────
/** Pages processed concurrently in each wave */
const BATCH_SIZE = 5;
/** Stop if this many consecutive pages fail */
const MAX_CONSECUTIVE_FAILURES = 5;
/** How many retry passes to run on failed pages */
const MAX_RETRY_PASSES = 2;

// ── Queue: limits concurrent Gemini calls across all runs ───────────
const geminiQueue = queue({
  name: "gemini-ocr",
  concurrencyLimit: 10,
});

// ── Sub-task: process a single PDF page ─────────────────────────────
export const processPage = task({
  id: "process-page",
  // 5 minutes per page — generous for large/complex pages
  maxDuration: 300,
  queue: geminiQueue,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 60000,
    factor: 2,
  },
  run: async (payload: { pageBase64: string; pageNumber: number }) => {
    logger.info(`[process-page] Start OCR for page ${payload.pageNumber}`);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    logger.debug(
      `[process-page] Calling Gemini ${GEMINI_MODEL} for page ${payload.pageNumber}`,
    );

    const result = await model.generateContent([
      OCR_PROMPT,
      {
        inlineData: {
          data: payload.pageBase64,
          mimeType: "application/pdf",
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();
    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount || 0;
    const outputTokens = usage?.candidatesTokenCount || 0;
    const cost = calculateCost(inputTokens, outputTokens);

    logger.info(
      `[process-page] Page ${payload.pageNumber} OK — ${text.length} chars, ` +
        `tokens in/out ${inputTokens}/${outputTokens}, cost $${cost.toFixed(6)}`,
    );

    return {
      pageNumber: payload.pageNumber,
      text,
      inputTokens,
      outputTokens,
      cost,
    };
  },
});

// ── Helper: flush progress to run metadata ──────────────────────────
function updateProgress(progress: ProgressMetadata) {
  metadata.set(
    "progress",
    JSON.parse(JSON.stringify(progress)) as unknown as DeserializedJson,
  );
}

const markdownBlobPath = (runId: string) => `scan-markdown/${runId}.md`;

const buildMarkdown = (runId: string, output: Omit<ProcessPdfOutput, "summary"> & { summary: ProcessPdfOutput["summary"] }) => {
  const successPages = output.pages.filter((page) => page.status === "success" && page.text.trim());
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
    parts.push(`## Page ${page.pageNumber}`, "", page.text, "");
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

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const blob = await put(markdownBlobPath(runId), markdown, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "text/markdown; charset=utf-8",
        cacheControlMaxAge: 60,
      });
      return blob.url;
    } catch (error) {
      lastError = error;
      logger.error(
        `[process-pdf] Markdown artifact upload failed on attempt ${attempt}/3: ${formatRunError(error)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  throw new Error(
    `[process-pdf] Failed to persist markdown artifact for ${runId}: ${formatRunError(lastError)}`,
  );
};

// ── Main task: split PDF → batched parallel processing ──────────────
export const processPdf = task({
  id: "process-pdf",
  // 2 hours — supports very large PDFs
  maxDuration: 7200,
  run: async (payload: {
    pdfBlobUrl: string;
    pageStart: number;
    pageEnd: number;
    totalPages: number;
  }, { ctx }): Promise<ProcessPdfOutput> => {
    // Private blob — authenticated read via BLOB_READ_WRITE_TOKEN (set in Trigger.dev env).
    const pdfBlob = await get(payload.pdfBlobUrl, { access: "private" });
    if (!pdfBlob || pdfBlob.statusCode !== 200) {
      throw new Error(
        `[process-pdf] Failed to download PDF blob: ${pdfBlob?.statusCode ?? "not found"}`,
      );
    }

    const pdfBytes = new Uint8Array(
      await new Response(pdfBlob.stream).arrayBuffer(),
    );
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const start = payload.pageStart;
    const end = payload.pageEnd;
    const pageCount = end - start + 1;

    // ── Phase: splitting ──
    const progress: ProgressMetadata = {
      phase: "splitting",
      totalPages: pageCount,
      completedCount: 0,
      failedCount: 0,
      retryAttempt: 0,
      pageStatuses: {},
    };

    // Initialize all page statuses
    for (let i = start; i <= end; i++) {
      progress.pageStatuses[String(i)] = "pending";
    }
    updateProgress(progress);

    logger.info(
      `[process-pdf] Splitting PDF into ${pageCount} single-page documents (pages ${start}–${end})`,
    );

    // Split PDF into single-page PDFs
    const pagePayloads: { pageBase64: string; pageNumber: number }[] = [];
    for (let i = start; i <= end; i++) {
      const singleDoc = await PDFDocument.create();
      const [page] = await singleDoc.copyPages(pdfDoc, [i - 1]);
      singleDoc.addPage(page);
      const singleBytes = await singleDoc.save();
      pagePayloads.push({
        pageBase64: Buffer.from(singleBytes).toString("base64"),
        pageNumber: i,
      });
    }

    // ── Phase: processing (batched with progress + circuit breaker) ──
    progress.phase = "processing";
    updateProgress(progress);

    const results = new Map<number, PageResult>();
    let consecutiveFailures = 0;
    let stopped = false;
    let stoppedReason: string | undefined;

    /**
     * Process a list of page payloads in waves of BATCH_SIZE.
     * Uses batchTriggerAndWait (not Promise.all + triggerAndWait) to avoid concurrency deadlocks
     * in the task runtime; progress updates once per batch when all pages in the wave complete.
     */
    const processInBatches = async (
      items: typeof pagePayloads,
    ): Promise<number[]> => {
      const failedPageNumbers: number[] = [];

      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        if (stopped) break;

        const batch = items.slice(i, i + BATCH_SIZE);
        const batchPageNumbers = batch.map((p) => p.pageNumber);
        const batchIndex = Math.floor(i / BATCH_SIZE) + 1;

        logger.info(
          `[process-pdf] Batch ${batchIndex}: queue pages [${batchPageNumbers.join(", ")}] (batchTriggerAndWait)`,
        );

        for (const p of batch) {
          progress.pageStatuses[String(p.pageNumber)] = "processing";
        }
        updateProgress(progress);

        const batchPayloads = batch.map((p) => ({ payload: p }));
        const batchResult = await processPage.batchTriggerAndWait(batchPayloads);

        for (let idx = 0; idx < batchResult.runs.length; idx++) {
          const run = batchResult.runs[idx];
          const p = batch[idx];
          const pageNum = p.pageNumber;

          if (run.ok && run.output) {
            logger.info(`[process-pdf] Page ${pageNum} success`);
            results.set(pageNum, {
              pageNumber: run.output.pageNumber,
              text: run.output.text,
              inputTokens: run.output.inputTokens,
              outputTokens: run.output.outputTokens,
              cost: run.output.cost,
              status: "success",
            });
            progress.pageStatuses[String(pageNum)] = "success";
            progress.completedCount++;
            consecutiveFailures = 0;
          } else {
            const errMsg = !run.ok ? getRunErrorMessage(run) : "unknown error";
            logger.error(
              `[process-pdf] Page ${pageNum} failed after retries: ${errMsg}`,
            );
            results.set(pageNum, {
              pageNumber: pageNum,
              text: "",
              inputTokens: 0,
              outputTokens: 0,
              cost: 0,
              status: "error",
              error: errMsg,
            });
            progress.pageStatuses[String(pageNum)] = "error";
            progress.failedCount++;
            failedPageNumbers.push(pageNum);
            consecutiveFailures++;

            logger.warn(
              `[process-pdf] Page ${pageNum} consecutive failure count: ${consecutiveFailures}`,
            );
          }
        }

        updateProgress(progress);

        // ── Circuit breaker ──
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stopped = true;
          const recentError = results.get(
            batchPageNumbers[batchPageNumbers.length - 1],
          )?.error;
          stoppedReason =
            `Circuit breaker: ${consecutiveFailures} consecutive page failures.` +
            (recentError ? ` Last error: ${recentError}` : "");
          logger.error(stoppedReason);

          for (let k = i + BATCH_SIZE; k < items.length; k++) {
            const remainingPage = items[k].pageNumber;
            if (!results.has(remainingPage)) {
              progress.pageStatuses[String(remainingPage)] = "pending";
            }
          }
          updateProgress(progress);
          break;
        }
      }

      return failedPageNumbers;
    };

    // ── First pass ──
    let failedPageNumbers = await processInBatches(pagePayloads);

    // ── Retry passes (only if not circuit-broken) ──
    for (
      let retryPass = 1;
      retryPass <= MAX_RETRY_PASSES && failedPageNumbers.length > 0 && !stopped;
      retryPass++
    ) {
      progress.phase = "retrying";
      progress.retryAttempt = retryPass;
      // Reset failed count — we'll recount
      progress.failedCount = 0;
      consecutiveFailures = 0;
      updateProgress(progress);

      logger.info(
        `[process-pdf] Retry pass ${retryPass}/${MAX_RETRY_PASSES}: ${failedPageNumbers.length} failed pages`,
      );

      // Get payloads for failed pages
      const retryItems = pagePayloads.filter((p) =>
        failedPageNumbers.includes(p.pageNumber),
      );

      // Reset their status to pending before retry
      for (const p of retryItems) {
        progress.pageStatuses[String(p.pageNumber)] = "pending";
        results.delete(p.pageNumber);
      }
      updateProgress(progress);

      failedPageNumbers = await processInBatches(retryItems);
    }

    // ── Finalize ──
    if (stopped) {
      progress.phase = "stopped";
      progress.stoppedReason = stoppedReason;
    } else {
      progress.phase = "done";
    }

    // Recount from results
    const allResults = Array.from(results.values());
    allResults.sort((a, b) => a.pageNumber - b.pageNumber);
    const successPages = allResults.filter((p) => p.status === "success");
    const failedPages = allResults.filter((p) => p.status === "error");

    progress.completedCount = successPages.length;
    progress.failedCount = failedPages.length;
    updateProgress(progress);

    const summary: ProcessPdfOutput["summary"] = {
      totalPages: pageCount,
      successCount: successPages.length,
      failedCount: failedPages.length,
      totalInputTokens: successPages.reduce((s, p) => s + p.inputTokens, 0),
      totalOutputTokens: successPages.reduce((s, p) => s + p.outputTokens, 0),
      totalCost: successPages.reduce((s, p) => s + p.cost, 0),
      stoppedEarly: stopped,
      stoppedReason,
    };

    const output: ProcessPdfOutput = { pages: allResults, summary };
    const markdownBlobUrl = await persistMarkdownArtifact(ctx.run.id, output);
    summary.markdownBlobPath = markdownBlobPath(ctx.run.id);
    summary.markdownBlobUrl = markdownBlobUrl ?? undefined;
    metadata.set("markdownBlobPath", summary.markdownBlobPath);

    logger.info(
      `[process-pdf] ${stopped ? "STOPPED" : "DONE"} — ${summary.successCount}/${summary.totalPages} pages, ` +
        `${summary.failedCount} failed, $${summary.totalCost.toFixed(6)} total` +
        (stoppedReason ? ` | ${stoppedReason}` : ""),
    );

    return output;
  },
});

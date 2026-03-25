import type { DeserializedJson } from "@trigger.dev/core";
import { task, logger, metadata, queue } from "@trigger.dev/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PDFDocument } from "pdf-lib";

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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    logger.info(`Processing page ${payload.pageNumber}`);

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
      `Page ${payload.pageNumber} done — ${inputTokens + outputTokens} tokens, $${cost.toFixed(6)}`,
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
  metadata.set("progress", progress as unknown as DeserializedJson);
}

// ── Main task: split PDF → batched parallel processing ──────────────
export const processPdf = task({
  id: "process-pdf",
  // 2 hours — supports very large PDFs
  maxDuration: 7200,
  run: async (payload: {
    pdfBase64: string;
    pageStart: number;
    pageEnd: number;
    totalPages: number;
  }): Promise<ProcessPdfOutput> => {
    const pdfBytes = Buffer.from(payload.pdfBase64, "base64");
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

    logger.info(`Splitting PDF into ${pageCount} single-page documents (pages ${start}–${end})`);

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
     * Updates metadata after each wave. Returns page numbers that failed.
     */
    const processInBatches = async (
      items: typeof pagePayloads,
    ): Promise<number[]> => {
      const failedPageNumbers: number[] = [];

      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        if (stopped) break;

        const batch = items.slice(i, i + BATCH_SIZE);

        // Mark batch pages as "processing"
        for (const p of batch) {
          progress.pageStatuses[String(p.pageNumber)] = "processing";
        }
        updateProgress(progress);

        logger.info(
          `Batch ${Math.floor(i / BATCH_SIZE) + 1}: pages ${batch.map((p) => p.pageNumber).join(", ")}`,
        );

        // Fan out this wave in parallel
        const batchResult = await processPage.batchTriggerAndWait(
          batch.map((p) => ({ payload: p })),
        );

        // Process wave results
        for (let j = 0; j < batchResult.runs.length; j++) {
          const run = batchResult.runs[j];
          const pageNum = batch[j].pageNumber;

          if (run.ok && run.output) {
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
            results.set(pageNum, {
              pageNumber: pageNum,
              text: "",
              inputTokens: 0,
              outputTokens: 0,
              cost: 0,
              status: "error",
              error: "Processing failed after retries",
            });
            progress.pageStatuses[String(pageNum)] = "error";
            progress.failedCount++;
            failedPageNumbers.push(pageNum);
            consecutiveFailures++;

            logger.warn(
              `Page ${pageNum} failed (consecutive failures: ${consecutiveFailures})`,
            );
          }
        }

        updateProgress(progress);

        // ── Circuit breaker ──
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stopped = true;
          stoppedReason = `Circuit breaker: ${consecutiveFailures} consecutive page failures. Likely a systemic issue (API down, rate limits, etc).`;
          logger.error(stoppedReason);

          // Mark remaining pages as pending (not attempted)
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
        `Retry pass ${retryPass}/${MAX_RETRY_PASSES}: ${failedPageNumbers.length} failed pages`,
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

    const summary = {
      totalPages: pageCount,
      successCount: successPages.length,
      failedCount: failedPages.length,
      totalInputTokens: successPages.reduce((s, p) => s + p.inputTokens, 0),
      totalOutputTokens: successPages.reduce((s, p) => s + p.outputTokens, 0),
      totalCost: successPages.reduce((s, p) => s + p.cost, 0),
      stoppedEarly: stopped,
      stoppedReason,
    };

    logger.info(
      `${stopped ? "STOPPED" : "DONE"} — ${summary.successCount}/${summary.totalPages} pages, ` +
        `${summary.failedCount} failed, $${summary.totalCost.toFixed(6)} total` +
        (stoppedReason ? ` | ${stoppedReason}` : ""),
    );

    return { pages: allResults, summary };
  },
});

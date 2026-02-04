import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { api, getConvexClient } from "@/lib/convex";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const PRICING = {
  INPUT_PER_1M: 0.5,
  OUTPUT_PER_1M: 3.0,
};

const calculateCost = (inputTokens: number, outputTokens: number) => {
  const inputCost = (inputTokens / 1_000_000) * PRICING.INPUT_PER_1M;
  const outputCost = (outputTokens / 1_000_000) * PRICING.OUTPUT_PER_1M;
  return inputCost + outputCost;
};

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { image, pageNumber } = await request.json();

    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500 }
      );
    }

    const convex = getConvexClient();
    await convex.mutation(api.users.ensureUser, {
      authUserId: session.user.id,
      email: session.user.email,
      name: session.user.name,
    });

    const requestId = crypto.randomUUID();
    const resolvedPageNumber =
      typeof pageNumber === "number" ? pageNumber : undefined;
    let creditsRemaining: number | null = null;

    try {
      const spendResult = await convex.mutation(api.credits.spend, {
        authUserId: session.user.id,
        amount: 1,
        reason: "scan_page",
        pageNumber: resolvedPageNumber,
        requestId,
      });
      creditsRemaining = spendResult.credits;
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      if (message.includes("INSUFFICIENT_CREDITS")) {
        return NextResponse.json(
          { error: "Insufficient credits" },
          { status: 402 },
        );
      }
      return NextResponse.json(
        { error: "Unable to reserve credits" },
        { status: 500 },
      );
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `
      System Instruction: You are a specialized OCR and document parsing engine. Task: Analyze the provided image of a document. Output Requirements:

No Conversational Text: Do not include any introductory remarks, explanations, or concluding statements. Output only the extracted content.

Text Extraction: Extract all visible text exactly as written.

Tabular Data: Represent all tables using clean Markdown table syntax.

Mathematical Notation: If the document contains complex formulas or equations, represent them using LaTeX within standard delimiters (e.g., $ ... $ or $$...$$).

Graphics & Visuals: If the document contains images, charts, or diagrams, provide a detailed description within a Markdown blockquote using the following format:

[GRAPHIC DESCRIPTION]: [Insert a comprehensive, detailed explanation of what the graphic shows here]

Formatting: Use Markdown headers and lists to mirror the document's original structure.
    `;

    const imagePart = {
      inlineData: {
        data: image,
        mimeType: "image/jpeg",
      },
    };

    try {
      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();

      const usage = response.usageMetadata;
      const inputTokens = usage?.promptTokenCount || 0;
      const outputTokens = usage?.candidatesTokenCount || 0;
      const cost = calculateCost(inputTokens, outputTokens);

      try {
        await convex.mutation(api.usage.record, {
          authUserId: session.user.id,
          pageNumber: resolvedPageNumber ?? 0,
          inputTokens,
          outputTokens,
          cost,
        });
      } catch (usageError) {
        console.warn("Usage record failed:", usageError);
      }

      return NextResponse.json({ text, usage, creditsRemaining });
    } catch (error: any) {
      await convex.mutation(api.credits.refund, {
        authUserId: session.user.id,
        amount: 1,
        reason: "scan_failed",
        pageNumber: resolvedPageNumber,
        requestId,
      });
      throw error;
    }
  } catch (error: any) {
    console.error("Gemini API Error:", error);

    const isRateLimit = error.message?.includes("429") || error.status === 429 || (error as any)?.response?.status === 429;

    if (isRateLimit) {
      return NextResponse.json(
        { error: "Too Many Requests (Rate Limit Exceeded). Please try again later." },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "Error processing image" },
      { status: 500 }
    );
  }
}

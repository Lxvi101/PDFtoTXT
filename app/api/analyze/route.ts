import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(request: NextRequest) {
  try {
    const { image } = await request.json();

    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500 }
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

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    // --- NEW: Extract Usage Metadata ---
    const usage = response.usageMetadata;
    // usage looks like: { promptTokenCount: 300, candidatesTokenCount: 150, totalTokenCount: 450 }

    return NextResponse.json({ text, usage });
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

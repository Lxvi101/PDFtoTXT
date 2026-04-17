import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getToken } from "@/lib/auth-server";

const MAX_SCAN_PDF_BYTES = 20 * 1024 * 1024;
const SCAN_PATH_PREFIX = "scan-pdfs/";

export async function POST(request: Request): Promise<NextResponse> {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
  }

  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(SCAN_PATH_PREFIX)) {
          throw new Error("Invalid upload path");
        }

        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_SCAN_PDF_BYTES,
          addRandomSuffix: false,
          // Give larger uploads enough time before token expiration.
          validUntil: Date.now() + 1000 * 60 * 5,
          tokenPayload: JSON.stringify({ source: "scan-pdf" }),
        };
      },
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to prepare upload";
    const status = message === "Unauthorized" ? 401 : 400;

    return NextResponse.json({ error: message }, { status });
  }
}

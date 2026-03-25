import { NextResponse } from "next/server";
import { getToken } from "@/lib/auth-server";
import { api, getAuthenticatedConvexClient } from "@/lib/convex";

const CREDIT_PACKS = {
  starter: { credits: 500, price: 9 },
  pro: { credits: 2500, price: 39 },
  business: { credits: 10000, price: 129 },
};

type PackId = keyof typeof CREDIT_PACKS;

export async function POST(request: Request) {
  const token = await getToken();

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const packId = body?.packId as PackId | undefined;

  if (!packId || !CREDIT_PACKS[packId]) {
    return NextResponse.json({ error: "Invalid pack" }, { status: 400 });
  }

  const pack = CREDIT_PACKS[packId];
  const convex = getAuthenticatedConvexClient(token);

  await convex.mutation(api.users.ensureUser, {});

  const result = await convex.mutation(api.credits.purchase, {
    amount: pack.credits,
    packId,
    reason: "manual_purchase",
  });

  return NextResponse.json({ credits: result.credits, pack });
}

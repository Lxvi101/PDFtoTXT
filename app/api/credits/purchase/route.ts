import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { api, getConvexClient } from "@/lib/convex";

const CREDIT_PACKS = {
  starter: { credits: 500, price: 9 },
  pro: { credits: 2500, price: 39 },
  business: { credits: 10000, price: 129 },
};

type PackId = keyof typeof CREDIT_PACKS;

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableRefresh: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const packId = body?.packId as PackId | undefined;

  if (!packId || !CREDIT_PACKS[packId]) {
    return NextResponse.json({ error: "Invalid pack" }, { status: 400 });
  }

  const pack = CREDIT_PACKS[packId];
  const convex = getConvexClient();

  await convex.mutation(api.users.ensureUser, {
    authUserId: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const result = await convex.mutation(api.credits.purchase, {
    authUserId: session.user.id,
    amount: pack.credits,
    packId,
    reason: "manual_purchase",
  });

  return NextResponse.json({ credits: result.credits, pack });
}

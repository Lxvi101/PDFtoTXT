import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { api, getConvexClient } from "@/lib/convex";

export async function GET(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableRefresh: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const convex = getConvexClient();
  await convex.mutation(api.users.ensureUser, {
    authUserId: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  const overview = await convex.query(api.credits.getOverview, {
    authUserId: session.user.id,
  });
  const recentUsage = await convex.query(api.usage.listRecent, {
    authUserId: session.user.id,
    limit: 6,
  });

  return NextResponse.json({ overview, recentUsage });
}

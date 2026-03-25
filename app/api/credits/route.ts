import { NextResponse } from "next/server";
import { getToken } from "@/lib/auth-server";
import { api, getAuthenticatedConvexClient } from "@/lib/convex";

export async function GET(request: Request) {
  const token = await getToken();

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const convex = getAuthenticatedConvexClient(token);

  const authUserId = await convex.query(api.users.getCurrentAuthUserId, {});
  if (!authUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await convex.mutation(api.users.ensureUser, {});

  const overview = await convex.query(api.credits.getOverview, {
    authUserId,
  });
  const recentUsage = await convex.query(api.usage.listRecent, {
    authUserId,
    limit: 6,
  });

  const scanRuns = await convex.query(api.scanRuns.listForDashboard, {});

  return NextResponse.json({ overview, recentUsage, scanRuns });
}

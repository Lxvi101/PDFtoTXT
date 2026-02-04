import { mutation, query } from "convex/server";
import { v } from "convex/values";

export const record = mutation({
  args: {
    authUserId: v.string(),
    pageNumber: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cost: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("usage", {
      authUserId: args.authUserId,
      pageNumber: args.pageNumber,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cost: args.cost,
      createdAt: now,
    });
    return { ok: true };
  },
});

export const listRecent = query({
  args: {
    authUserId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 6, 20);
    return await ctx.db
      .query("usage")
      .withIndex("by_auth_user_created", (q) => q.eq("authUserId", args.authUserId))
      .order("desc")
      .take(limit);
  },
});

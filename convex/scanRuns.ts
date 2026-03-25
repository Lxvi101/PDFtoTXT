import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    triggerRunId: v.string(),
    requestId: v.string(),
    pageCount: v.number(),
    pageStart: v.number(),
    pageEnd: v.number(),
    totalPages: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const existing = await ctx.db
      .query("scanRuns")
      .withIndex("by_trigger_run", (q) => q.eq("triggerRunId", args.triggerRunId))
      .unique();
    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    return await ctx.db.insert("scanRuns", {
      authUserId: identity.subject,
      triggerRunId: args.triggerRunId,
      requestId: args.requestId,
      pageCount: args.pageCount,
      pageStart: args.pageStart,
      pageEnd: args.pageEnd,
      totalPages: args.totalPages,
      isActive: true,
      status: "processing",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const complete = mutation({
  args: {
    triggerRunId: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("stopped"),
    ),
    successCount: v.optional(v.number()),
    failedCount: v.optional(v.number()),
    stoppedEarly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const doc = await ctx.db
      .query("scanRuns")
      .withIndex("by_trigger_run", (q) => q.eq("triggerRunId", args.triggerRunId))
      .unique();
    if (!doc || doc.authUserId !== identity.subject) return;
    if (!doc.isActive) return;

    const now = Date.now();
    await ctx.db.patch(doc._id, {
      isActive: false,
      status: args.status,
      successCount: args.successCount,
      failedCount: args.failedCount,
      stoppedEarly: args.stoppedEarly,
      finishedAt: now,
      updatedAt: now,
    });
  },
});

export const listForDashboard = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { active: [] as const, recent: [] as const };
    }

    const authUserId = identity.subject;

    const activeRows = await ctx.db
      .query("scanRuns")
      .withIndex("by_auth_user_active", (q) =>
        q.eq("authUserId", authUserId).eq("isActive", true),
      )
      .collect();
    const active = activeRows.sort((a, b) => b.createdAt - a.createdAt);

    const recent = await ctx.db
      .query("scanRuns")
      .withIndex("by_auth_user_created", (q) => q.eq("authUserId", authUserId))
      .order("desc")
      .take(30);

    return { active, recent };
  },
});

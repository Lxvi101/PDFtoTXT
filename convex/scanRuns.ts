import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    triggerRunId: v.string(),
    requestId: v.string(),
    fileName: v.optional(v.string()),
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
      fileName: args.fileName,
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

export const sync = mutation({
  args: {
    triggerRunId: v.string(),
    triggerStatus: v.optional(v.string()),
    progress: v.optional(v.any()),
    output: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    errorName: v.optional(v.string()),
    errorStack: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const doc = await ctx.db
      .query("scanRuns")
      .withIndex("by_trigger_run", (q) => q.eq("triggerRunId", args.triggerRunId))
      .unique();
    if (!doc || doc.authUserId !== identity.subject) return;

    const now = Date.now();
    await ctx.db.patch(doc._id, {
      triggerStatus: args.triggerStatus,
      progress: args.progress,
      output: args.output,
      errorMessage: args.errorMessage,
      errorName: args.errorName,
      errorStack: args.errorStack,
      lastPolledAt: now,
      updatedAt: now,
    });
  },
});

export const notePollError = mutation({
  args: {
    triggerRunId: v.string(),
    errorMessage: v.string(),
    errorName: v.optional(v.string()),
    errorStack: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const doc = await ctx.db
      .query("scanRuns")
      .withIndex("by_trigger_run", (q) => q.eq("triggerRunId", args.triggerRunId))
      .unique();
    if (!doc || doc.authUserId !== identity.subject) return;

    const now = Date.now();
    await ctx.db.patch(doc._id, {
      errorMessage: args.errorMessage,
      errorName: args.errorName,
      errorStack: args.errorStack,
      lastPolledAt: now,
      updatedAt: now,
    });
  },
});

export const finalize = mutation({
  args: {
    triggerRunId: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("stopped"),
    ),
    output: v.optional(v.any()),
    progress: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    errorName: v.optional(v.string()),
    errorStack: v.optional(v.string()),
    triggerStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const doc = await ctx.db
      .query("scanRuns")
      .withIndex("by_trigger_run", (q) => q.eq("triggerRunId", args.triggerRunId))
      .unique();
    if (!doc || doc.authUserId !== identity.subject) return;

    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", identity.subject))
      .unique();

    const now = Date.now();
    const output = args.output as
      | {
          pages?: Array<{
            pageNumber?: number;
            status?: string;
            inputTokens?: number;
            outputTokens?: number;
            cost?: number;
          }>;
          summary?: {
            successCount?: number;
            failedCount?: number;
            stoppedEarly?: boolean;
          };
        }
      | undefined;
    const progress = args.progress as
      | {
          pageStatuses?: Record<string, string>;
        }
      | undefined;

    const successCount = output?.summary?.successCount ?? doc.successCount;
    const failedCount = output?.summary?.failedCount ?? doc.failedCount;
    const stoppedEarly = output?.summary?.stoppedEarly ?? args.status === "stopped";
    const patch: Record<string, unknown> = {
      isActive: false,
      status: args.status,
      successCount,
      failedCount,
      stoppedEarly,
      progress: args.progress,
      output: args.output,
      errorMessage: args.errorMessage,
      errorName: args.errorName,
      errorStack: args.errorStack,
      triggerStatus: args.triggerStatus,
      finishedAt: doc.finishedAt ?? now,
      lastPolledAt: now,
      updatedAt: now,
    };

    const shouldRefund = !!user && !user.isAdmin;
    let refundCreditDelta = 0;

    if (args.status === "failed" && shouldRefund && !doc.failedRefundedAt) {
      await ctx.db.insert("creditEvents", {
        authUserId: identity.subject,
        type: "refund",
        amount: doc.pageCount,
        reason: "scan_run_failed",
        createdAt: now,
        metadata: { requestId: `${doc.requestId}_failed` },
      });
      refundCreditDelta += doc.pageCount;
      patch.failedRefundedAt = now;
    }

    if (args.status !== "failed" && output) {
      const failedPages = output.summary?.failedCount ?? 0;
      if (failedPages > 0 && shouldRefund && !doc.partialRefundedAt) {
        await ctx.db.insert("creditEvents", {
          authUserId: identity.subject,
          type: "refund",
          amount: failedPages,
          reason: "scan_pages_failed",
          createdAt: now,
          metadata: { requestId: `${doc.requestId}_partial` },
        });
        refundCreditDelta += failedPages;
        patch.partialRefundedAt = now;
      }

      const pendingCount = progress?.pageStatuses
        ? Object.values(progress.pageStatuses).filter((status) => status === "pending").length
        : 0;
      if (pendingCount > 0 && shouldRefund && !doc.unattemptedRefundedAt) {
        await ctx.db.insert("creditEvents", {
          authUserId: identity.subject,
          type: "refund",
          amount: pendingCount,
          reason: "scan_stopped_early",
          createdAt: now,
          metadata: { requestId: `${doc.requestId}_unattempted` },
        });
        refundCreditDelta += pendingCount;
        patch.unattemptedRefundedAt = now;
      }

      if (!doc.usageRecordedAt) {
        for (const page of output.pages?.filter((p) => p.status === "success") ?? []) {
          await ctx.db.insert("usage", {
            authUserId: identity.subject,
            pageNumber: page.pageNumber ?? 0,
            inputTokens: page.inputTokens ?? 0,
            outputTokens: page.outputTokens ?? 0,
            cost: page.cost ?? 0,
            createdAt: now,
          });
        }
        patch.usageRecordedAt = now;
      }
    }

    if (user && refundCreditDelta > 0) {
      await ctx.db.patch(user._id, {
        credits: user.credits + refundCreditDelta,
        updatedAt: now,
      });
    }

    await ctx.db.patch(doc._id, patch);
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

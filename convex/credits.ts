import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const getUserByAuthId = async (ctx: any, authUserId: string) => {
  return await ctx.db
    .query("users")
    .withIndex("by_auth_user", (q: any) => q.eq("authUserId", authUserId))
    .unique();
};

const sumEvents = (events: Array<{ type: string; amount: number }>, type: string) =>
  events
    .filter((event) => event.type === type)
    .reduce((total, event) => total + event.amount, 0);

export const getOverview = query({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserByAuthId(ctx, args.authUserId);
    if (!user) return null;

    const events = await ctx.db
      .query("creditEvents")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", args.authUserId))
      .collect();

    const recentEvents = await ctx.db
      .query("creditEvents")
      .withIndex("by_auth_user_created", (q) => q.eq("authUserId", args.authUserId))
      .order("desc")
      .take(6);

    const totals = {
      granted: sumEvents(events, "grant"),
      purchased: sumEvents(events, "purchase"),
      spent: sumEvents(events, "spend"),
      refunded: sumEvents(events, "refund"),
    };

    return {
      user,
      totals,
      recentEvents,
    };
  },
});

export const spend = mutation({
  args: {
    amount: v.number(),
    reason: v.string(),
    pageNumber: v.optional(v.number()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    if (args.amount <= 0) throw new Error("INVALID_AMOUNT");

    const user = await getUserByAuthId(ctx, identity.subject);
    if (!user) throw new Error("USER_NOT_FOUND");

    if (user.isAdmin) {
      return { credits: user.credits };
    }

    if (user.credits < args.amount) {
      throw new Error("INSUFFICIENT_CREDITS");
    }

    const now = Date.now();
    const nextCredits = user.credits - args.amount;

    await ctx.db.patch(user._id, {
      credits: nextCredits,
      updatedAt: now,
    });

    await ctx.db.insert("creditEvents", {
      authUserId: identity.subject,
      type: "spend",
      amount: args.amount,
      reason: args.reason,
      createdAt: now,
      metadata: {
        pageNumber: args.pageNumber,
        requestId: args.requestId,
      },
    });

    return { credits: nextCredits };
  },
});

export const refund = mutation({
  args: {
    amount: v.number(),
    reason: v.string(),
    pageNumber: v.optional(v.number()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    if (args.amount <= 0) throw new Error("INVALID_AMOUNT");

    const user = await getUserByAuthId(ctx, identity.subject);
    if (!user) throw new Error("USER_NOT_FOUND");

    const now = Date.now();
    const nextCredits = user.credits + args.amount;

    await ctx.db.patch(user._id, {
      credits: nextCredits,
      updatedAt: now,
    });

    await ctx.db.insert("creditEvents", {
      authUserId: identity.subject,
      type: "refund",
      amount: args.amount,
      reason: args.reason,
      createdAt: now,
      metadata: {
        pageNumber: args.pageNumber,
        requestId: args.requestId,
      },
    });

    return { credits: nextCredits };
  },
});

export const purchase = mutation({
  args: {
    amount: v.number(),
    packId: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    if (args.amount <= 0) throw new Error("INVALID_AMOUNT");

    const user = await getUserByAuthId(ctx, identity.subject);
    if (!user) throw new Error("USER_NOT_FOUND");

    const now = Date.now();
    const nextCredits = user.credits + args.amount;

    await ctx.db.patch(user._id, {
      credits: nextCredits,
      updatedAt: now,
    });

    await ctx.db.insert("creditEvents", {
      authUserId: identity.subject,
      type: "purchase",
      amount: args.amount,
      reason: args.reason,
      createdAt: now,
      metadata: {
        packId: args.packId,
      },
    });

    return { credits: nextCredits };
  },
});

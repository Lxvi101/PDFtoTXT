import { mutation, query } from "convex/server";
import { v } from "convex/values";

const STARTING_CREDITS = 100;
const DEFAULT_PLAN = "free";

export const getByAuthId = query({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", args.authUserId))
      .unique();
  },
});

export const ensureUser = mutation({
  args: {
    authUserId: v.string(),
    email: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", args.authUserId))
      .unique();

    const now = Date.now();
    if (existing) {
      if (existing.email !== args.email || existing.name !== args.name) {
        await ctx.db.patch(existing._id, {
          email: args.email,
          name: args.name,
          updatedAt: now,
        });
      }
      return existing;
    }

    const userId = await ctx.db.insert("users", {
      authUserId: args.authUserId,
      email: args.email,
      name: args.name,
      credits: STARTING_CREDITS,
      plan: DEFAULT_PLAN,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("creditEvents", {
      authUserId: args.authUserId,
      type: "grant",
      amount: STARTING_CREDITS,
      reason: "welcome_grant",
      createdAt: now,
    });

    return await ctx.db.get(userId);
  },
});

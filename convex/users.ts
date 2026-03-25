import { mutation, query } from "./_generated/server";
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

export const getCurrentAuthUserId = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return identity?.subject ?? null;
  },
});

export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", identity.subject))
      .unique();

    const now = Date.now();
    
    const name = identity.name || identity.email || "User";
    const email = identity.email || "";

    if (existing) {
      if (existing.email !== email || existing.name !== name) {
        await ctx.db.patch(existing._id, {
          email,
          name,
          updatedAt: now,
        });
      }
      return existing;
    }

    const userId = await ctx.db.insert("users", {
      authUserId: identity.subject,
      email,
      name,
      credits: STARTING_CREDITS,
      plan: DEFAULT_PLAN,
      isAdmin: false,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("creditEvents", {
      authUserId: identity.subject,
      type: "grant",
      amount: STARTING_CREDITS,
      reason: "welcome_grant",
      createdAt: now,
    });

    return await ctx.db.get(userId);
  },
});

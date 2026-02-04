import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    authUserId: v.string(),
    email: v.string(),
    name: v.string(),
    credits: v.number(),
    plan: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_auth_user", ["authUserId"]),
  creditEvents: defineTable({
    authUserId: v.string(),
    type: v.union(
      v.literal("grant"),
      v.literal("purchase"),
      v.literal("spend"),
      v.literal("refund"),
    ),
    amount: v.number(),
    reason: v.string(),
    createdAt: v.number(),
    metadata: v.optional(
      v.object({
        pageNumber: v.optional(v.number()),
        packId: v.optional(v.string()),
        requestId: v.optional(v.string()),
      }),
    ),
  })
    .index("by_auth_user", ["authUserId"])
    .index("by_auth_user_created", ["authUserId", "createdAt"]),
  usage: defineTable({
    authUserId: v.string(),
    pageNumber: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cost: v.number(),
    createdAt: v.number(),
  })
    .index("by_auth_user", ["authUserId"])
    .index("by_auth_user_created", ["authUserId", "createdAt"]),
});

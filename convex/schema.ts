import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    authUserId: v.string(),
    email: v.string(),
    name: v.string(),
    credits: v.number(),
    plan: v.string(),
    isAdmin: v.optional(v.boolean()),
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

  /** Trigger.dev PDF scans: history + isActive for in-progress runs */
  scanRuns: defineTable({
    authUserId: v.string(),
    triggerRunId: v.string(),
    requestId: v.string(),
    pageCount: v.number(),
    pageStart: v.number(),
    pageEnd: v.number(),
    totalPages: v.number(),
    isActive: v.boolean(),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("stopped"),
    ),
    successCount: v.optional(v.number()),
    failedCount: v.optional(v.number()),
    stoppedEarly: v.optional(v.boolean()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_auth_user_created", ["authUserId", "createdAt"])
    .index("by_auth_user_active", ["authUserId", "isActive"])
    .index("by_trigger_run", ["triggerRunId"]),
});

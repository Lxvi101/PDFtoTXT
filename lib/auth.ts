import { betterAuth } from "better-auth/minimal";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { nextCookies } from "better-auth/next-js";

const globalForAuth = globalThis as unknown as { __betterAuthDb?: MemoryDB };

const memoryDb: MemoryDB = globalForAuth.__betterAuthDb ?? {
  user: [],
  session: [],
  account: [],
  verification: [],
  rateLimit: [],
};

globalForAuth.__betterAuthDb = memoryDb;

export const auth = betterAuth({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
  },
  database: memoryAdapter(memoryDb),
  plugins: [nextCookies()],
});

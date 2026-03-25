import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // TODO: Replace with your Trigger.dev project ref from the dashboard
  project: "proj_kqciilrvkwnzzqasxcog",
  runtime: "node",
  logLevel: "log",
  dirs: ["trigger"],
  maxDuration: 3600, // 1 hour default; overridden per-task where needed
  // Self-hosted: set TRIGGER_API_URL=https://trigger.levidan.com in .env.local
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      factor: 2,
    },
  },
});

import "dotenv/config";
import dns from "node:dns";

if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

import { startScheduler } from "./scheduler";
import { startWorker } from "./polling-worker";

/**
 * Worker Entry Point
 *
 * Starts both the scheduler (DB scanner) and the polling worker.
 * This should be run as a standalone process, separate from the Next.js app.
 *
 * Usage:
 *   npm run dev     (development with hot-reload)
 *   npm run start   (production)
 *
 * Environment variables (from .env):
 *   DATABASE_URL             - PostgreSQL connection string
 *   REDIS_URL                - Redis connection string
 *   POLLING_INTERVAL_MS      - How often to poll the API (default: 500ms)
 *   CAMPAIGN_TIMEOUT_MINUTES - When to expire campaigns (default: 10 min)
 *   POLLING_START_BEFORE_SECONDS - Start polling N seconds before publish time (default: 120)
 */

console.log("═══════════════════════════════════════════");
console.log("  🐸 PepeShops Worker Starting...         ");
console.log("═══════════════════════════════════════════");
console.log(`  Time: ${new Date().toISOString()}`);
console.log(`  Redis: ${process.env.REDIS_URL || "redis://localhost:6379"}`);
console.log(`  DB: ${process.env.DATABASE_URL ? "✅ configured" : "❌ missing"}`);
console.log(`  Polling Interval: ${process.env.POLLING_INTERVAL_MS || 500}ms`);
console.log(`  Campaign Timeout: ${process.env.CAMPAIGN_TIMEOUT_MINUTES || 10} min`);
console.log("═══════════════════════════════════════════\n");

// Start the worker (processes polling jobs from the queue)
const worker = startWorker();

// Start the scheduler (scans DB and enqueues jobs)
startScheduler().catch((err) => {
  console.error("❌ Failed to start scheduler:", err);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down worker...");
  await worker.close();
  console.log("👋 Worker stopped");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, shutting down...");
  await worker.close();
  console.log("👋 Worker stopped");
  process.exit(0);
});

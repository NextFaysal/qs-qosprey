import { Queue } from "bullmq";
import IORedis from "ioredis";
import "dotenv/config";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Shared Redis connection
export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Queue for campaign polling jobs
export const campaignPollingQueue = new Queue("campaign-polling", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "fixed",
      delay: 1000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600, // keep completed jobs for 24 hours
    },
    removeOnFail: {
      count: 200,
      age: 72 * 3600, // keep failed jobs for 72 hours
    },
  },
});

console.log("📡 Redis connected, queues initialized");

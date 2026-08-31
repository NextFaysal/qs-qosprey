import { PrismaClient } from "@prisma/client";
import { campaignPollingQueue } from "./queues";
import "dotenv/config";

const prisma = new PrismaClient();

const SCAN_INTERVAL_MS = 5000; // Scan every 5 seconds
const POLLING_START_BEFORE_SECONDS = parseInt(
  process.env.POLLING_START_BEFORE_SECONDS || "120",
  10
);

/**
 * Scheduler - scans the database for campaigns that should start polling
 * Runs as a persistent loop, checking every few seconds
 */
async function scanAndSchedule() {
  try {
    const now = new Date();
    const threshold = new Date(
      now.getTime() + POLLING_START_BEFORE_SECONDS * 1000
    );

    // Find SCHEDULED campaigns whose publishTime is within the threshold
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: "SCHEDULED",
        publishTime: {
          lte: threshold,
        },
      },
      include: {
        account: {
          select: {
            token: true,
            domain: true,
            name: true,
            remoteUsername: true,
          },
        },
        user: {
          select: {
            defaultDomain: true,
            apiCredential: true,
          },
        },
      },
    });

    if (campaigns.length > 0) {
      console.log(
        `⏰ Found ${campaigns.length} campaign(s) ready for polling`
      );
    }

    for (const campaign of campaigns) {
      // Calculate delay until publishTime - buffer
      const delayMs = Math.max(
        0,
        campaign.publishTime.getTime() -
          now.getTime() -
          POLLING_START_BEFORE_SECONDS * 1000
      );

      // Resolve domain and API credential with proper fallback
      const resolvedDomain =
        campaign.domain ||
        campaign.account?.domain ||
        campaign.user.defaultDomain ||
        "https://api.pepecards2f7z1qtyyg.top";

      const resolvedCredential =
        campaign.account?.token ||
        campaign.user.apiCredential ||
        undefined;

      // Add job to polling queue
      await campaignPollingQueue.add(
        `poll-${campaign.id}`,
        {
          campaignId: campaign.id,
          domain: resolvedDomain,
          bins: campaign.bins,
          minPrice: campaign.minPrice ?? null,
          maxPrice: campaign.maxPrice ?? null,
          quantity: campaign.quantity,
          baseId: campaign.baseId ?? null,
          productDate: campaign.productDate ?? null,
          productEndDate: campaign.productEndDate ?? null,
          mode: campaign.mode || "AUTO_BUY",
          isCheck: campaign.isCheck ?? 1,
          accountId: campaign.accountId || undefined,
          publishTime: campaign.publishTime.toISOString(),
          apiCredential: resolvedCredential,
        },
        {
          delay: delayMs,
          jobId: `campaign-${campaign.id}`, // Prevent duplicate jobs
        }
      );

      // Update status to POLLING
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "POLLING" },
      });

      // Log the scheduling
      await prisma.campaignLog.create({
        data: {
          campaignId: campaign.id,
          event: "POLLING_SCHEDULED",
          detail: `Polling job queued. Will start in ${Math.round(
            delayMs / 1000
          )}s. Publish time: ${campaign.publishTime.toISOString()}`,
        },
      });

      console.log(
        `📋 Campaign ${campaign.id} queued for polling (delay: ${Math.round(
          delayMs / 1000
        )}s)`
      );
    }
  } catch (error) {
    console.error("❌ Scheduler scan error:", error);
  }
}

/**
 * Start the scheduler loop
 */
async function startScheduler() {
  console.log("🚀 Scheduler started");
  console.log(
    `   Scanning every ${SCAN_INTERVAL_MS / 1000}s`
  );
  console.log(
    `   Polling starts ${POLLING_START_BEFORE_SECONDS}s before publish time`
  );

  // Initial scan
  await scanAndSchedule();

  // Continuous scanning loop
  setInterval(scanAndSchedule, SCAN_INTERVAL_MS);
}

// Run if this file is executed directly (not when imported)
if (process.argv[1] && process.argv[1].endsWith("scheduler.ts")) {
  startScheduler().catch(console.error);
}

export { startScheduler };

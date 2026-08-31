import { Worker, Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { redisConnection } from "./queues";
import {
  pollGoodsList,
  addToCart,
  getCartLists,
  settleCart,
  verifyMemberInfo,
  getPollingInterval,
  sleep,
} from "./http-client";
import "dotenv/config";

const prisma = new PrismaClient();

const CAMPAIGN_TIMEOUT_MINUTES = parseInt(
  process.env.CAMPAIGN_TIMEOUT_MINUTES || "10",
  10
);

interface CampaignJobData {
  campaignId: string;
  domain: string;
  bins: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  quantity: number;
  baseId?: string | null;
  productDate?: string | null;
  productEndDate?: string | null;
  mode?: "CHECK_ONLY" | "AUTO_BUY";
  isCheck?: number;
  accountId?: string;
  publishTime: string;
  apiCredential?: string;
}

/**
 * Process a campaign polling job
 * Handles polling, add to cart, cart verification, settlement order, and balance update
 */
async function processCampaignJob(job: Job<CampaignJobData>) {
  const {
    campaignId,
    domain,
    bins,
    minPrice,
    maxPrice,
    quantity,
    baseId,
    productDate,
    productEndDate,
    mode = "AUTO_BUY",
    isCheck = 1,
    accountId,
    publishTime,
    apiCredential,
  } = job.data;

  // First verify campaign exists and is active in DB
  const campaignRecord = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, status: true, accountId: true, isCheck: true },
  });

  if (!campaignRecord || campaignRecord.status === "CANCELLED") {
    console.log(`⛔ Campaign ${campaignId} was cancelled or deleted`);
    return;
  }

  console.log(`\n🔄 Starting polling for campaign ${campaignId}`);
  console.log(`   Domain: ${domain}`);
  console.log(
    `   Bins: ${bins}, Price: ${minPrice ?? "any"}-${maxPrice ?? "any"}, Date: >= ${productDate || "any"}`
  );
  console.log(`   Quantity: ${quantity}, is_check: ${isCheck}`);

  if (!domain) {
    await updateCampaignStatus(campaignId, "FAILED", "No domain configured");
    return;
  }

  const pollingInterval = getPollingInterval();
  const pollingStartTime = Date.now();
  const timeoutDate = new Date(
    pollingStartTime + CAMPAIGN_TIMEOUT_MINUTES * 60 * 1000
  );

  let pollCount = 0;

  // Log polling start
  await prisma.campaignLog.create({
    data: {
      campaignId,
      event: "POLLING_STARTED",
      detail: `Polling started. Timeout window: ${CAMPAIGN_TIMEOUT_MINUTES} minutes from start. Interval: ${pollingInterval}ms`,
    },
  });

  // === POLLING LOOP ===
  while (true) {
    // Check if campaign was cancelled or deleted
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });

    if (!campaign || campaign.status === "CANCELLED") {
      console.log(`⛔ Campaign ${campaignId} was cancelled or removed`);
      return;
    }

    // Check timeout: 5 minutes from start of polling
    if (Date.now() > timeoutDate.getTime()) {
      const timeoutMsg = "নির্ধারিত ৫ মিনিটে কোনো প্রোডাক্ট পাওয়া যায়নি (No product found)";
      console.log(`⏰ Campaign ${campaignId}: ${timeoutMsg}`);

      await prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: "EXPIRED",
          lastError: timeoutMsg,
          settlementMsg: timeoutMsg,
        },
      });

      await prisma.campaignLog.create({
        data: {
          campaignId,
          event: "CAMPAIGN_TIMEOUT",
          detail: `${timeoutMsg} — ${pollCount} বার খোঁজা হয়েছে`,
        },
      });

      return;
    }

    pollCount++;

    try {
      // 1. Poll the lists API
      const result = await pollGoodsList(
        domain,
        {
          bins,
          minPrice,
          maxPrice,
          baseId,
          productDate,
          productEndDate,
        },
        apiCredential
      );

      // Update last checked timestamp
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { lastCheckedAt: new Date() },
      });

      // Log poll attempt periodically (every 10th attempt to avoid log spam)
      if (pollCount % 10 === 1) {
        await prisma.campaignLog.create({
          data: {
            campaignId,
            event: "POLL_ATTEMPT",
            detail: `Poll #${pollCount} — ${
              result.found ? "MATCH FOUND!" : "No match"
            }`,
          },
        });
      }

      if (result.found && result.ids.length > 0) {
        // === MATCH FOUND ===
        const matchedIds = result.ids.slice(0, quantity);
        console.log(
          `⚡ [SNIPER] Campaign ${campaignId}: MATCH FOUND! (${matchedIds.length} cards: ${matchedIds.join(
            ", "
          )}) — Executing Zero-Delay Fast Pipeline!`
        );

        if (mode === "AUTO_BUY") {
          const pipelineStart = Date.now();

          // 1. Fire addToCart IMMEDIATELY without waiting for DB writes!
          const buyResultPromise = addToCart(domain, matchedIds, apiCredential);

          // Asynchronously record match to DB in background (non-blocking)
          prisma.campaign.update({
            where: { id: campaignId },
            data: { matchedIds },
          }).catch(console.error);

          prisma.campaignLog.create({
            data: {
              campaignId,
              event: "MATCH_FOUND",
              detail: `Found ${matchedIds.length} product(s): ${matchedIds.join(", ")} (after ${pollCount} polls)`,
            },
          }).catch(console.error);

          const buyResult = await buyResultPromise;
          console.log(`🛒 [SNIPER] AddCart done in ${Date.now() - pipelineStart}ms: ${buyResult.message}`);

          // 2. Immediately fetch cartLists with 0ms sleep!
          const cartListsStart = Date.now();
          const cartListsResult = await getCartLists(domain, apiCredential);
          console.log(`📋 [SNIPER] CartLists resolved in ${Date.now() - cartListsStart}ms`);

          let targetCartIds: number[] = [];
          if (cartListsResult.items && cartListsResult.items.length > 0) {
            // Strictly match ONLY the specific products filtered and added by THIS campaign
            const matchedNumIds = matchedIds.map(Number);
            const matchingItems = cartListsResult.items.filter((item) =>
              matchedNumIds.includes(item.card_id)
            );

            targetCartIds = matchingItems.map((item) => item.id);
          }

          if (targetCartIds.length === 0) {
            console.log(`⚠️ No cart items found to settle for campaign ${campaignId}`);
            await updateCampaignStatus(
              campaignId,
              "FAILED",
              `Cart was empty after addCart. AddCart message: ${buyResult.message}`
            );
            await prisma.campaignLog.create({
              data: {
                campaignId,
                event: "SETTLEMENT_FAILED",
                detail: `No cart IDs found. AddCart message: ${buyResult.message}`,
              },
            });
            return;
          }

          // 3. Immediately fire settlement without waiting for DB writes!
          const checkParam = isCheck === 2 ? 2 : 1;
          const settleStart = Date.now();
          console.log(
            `💳 [SNIPER] Direct settlement for cart IDs [${targetCartIds.join(
              ", "
            )}] with is_check=${checkParam}...`
          );

          const settleResult = await settleCart(
            domain,
            targetCartIds,
            checkParam,
            apiCredential
          );

          const totalPipelineMs = Date.now() - pipelineStart;
          console.log(
            `💳 [SNIPER] Settlement completed in ${Date.now() - settleStart}ms! Total execution time: ${totalPipelineMs}ms. Response: "${settleResult.message}"`
          );

          const isSuccess = settleResult.resCode === 1;

          // 4. Save final state to database
          await prisma.campaign.update({
            where: { id: campaignId },
            data: {
              status: isSuccess ? "SUCCESS" : "FAILED",
              cartIds: targetCartIds.map(String),
              settlementMsg: settleResult.message,
              purchasedIds: isSuccess ? matchedIds : [],
              lastError: isSuccess ? null : settleResult.message,
            },
          });

          await prisma.campaignLog.create({
            data: {
              campaignId,
              event: isSuccess ? "ORDER_SUCCESS" : "ORDER_FAILED",
              detail: `Settlement ResCode: ${settleResult.resCode}, Message: ${settleResult.message}`,
            },
          });

          // === STEP 5: REFRESH ACCOUNT BALANCE ===
          const effectiveAccountId = accountId || campaignRecord.accountId;
          if (effectiveAccountId && apiCredential) {
            try {
              console.log(`💰 Syncing fresh balance for account ${effectiveAccountId}...`);
              const memberInfo = await verifyMemberInfo(domain, apiCredential);
              if (memberInfo.valid && memberInfo.data) {
                await prisma.account.update({
                  where: { id: effectiveAccountId },
                  data: {
                    balance: memberInfo.data.money,
                    remoteUsername: memberInfo.data.username || undefined,
                  },
                });
                console.log(`💰 Account balance updated: $${memberInfo.data.money}`);
                await prisma.campaignLog.create({
                  data: {
                    campaignId,
                    event: "BALANCE_UPDATED",
                    detail: `Account balance updated: $${memberInfo.data.money}`,
                  },
                });
              }
            } catch (balError) {
              console.error(`⚠️ Balance sync error:`, balError);
            }
          }
        } else {
          // CHECK_ONLY mode — save matched product IDs and mark SUCCESS
          console.log(
            `👁️ Campaign ${campaignId}: Check-only mode, product found`
          );
          await prisma.campaign.update({
            where: { id: campaignId },
            data: {
              status: "SUCCESS",
              settlementMsg: "Products found in Check-Only mode",
            },
          });
          await prisma.campaignLog.create({
            data: {
              campaignId,
              event: "CHECK_COMPLETE",
              detail: `Products found: ${matchedIds.join(", ")}`,
            },
          });
        }

        return; // Exit polling loop
      }
    } catch (pollError) {
      const errorMsg =
        pollError instanceof Error ? pollError.message : "Unknown poll error";
      console.error(
        `⚠️ Campaign ${campaignId}: Poll error — ${errorMsg}`
      );

      // Check if campaign still exists before writing error
      const stillExists = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true },
      });

      if (!stillExists) {
        console.log(`⛔ Campaign ${campaignId} removed during polling`);
        return;
      }

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { lastError: errorMsg },
      });

      if (pollCount % 5 === 0) {
        await prisma.campaignLog.create({
          data: {
            campaignId,
            event: "POLL_ERROR",
            detail: `Poll #${pollCount} error: ${errorMsg}`,
          },
        });
      }
    }

    // Wait before next poll
    await sleep(pollingInterval);
  }
}

/**
 * Helper to update campaign status with error message
 */
async function updateCampaignStatus(
  campaignId: string,
  status: "FAILED" | "EXPIRED",
  errorMessage: string
) {
  try {
    const exists = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true },
    });
    if (!exists) return;

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status,
        lastError: errorMessage,
      },
    });
  } catch (err) {
    console.error(`Status update error for ${campaignId}:`, err);
  }
}

/**
 * Start the polling worker
 */
function startWorker() {
  const worker = new Worker("campaign-polling", processCampaignJob, {
    connection: redisConnection,
    concurrency: 50, // Handles 50 concurrent campaign polling jobs simultaneously
  });

  worker.on("completed", (job) => {
    console.log(`✅ Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("❌ Worker error:", err);
  });

  console.log("⚙️  Polling worker started (concurrency: 50)");

  return worker;
}

export { startWorker };

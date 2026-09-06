import { Worker, Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { redisConnection } from "./queues";
import {
  pollGoodsList,
  addToCart,
  getCartLists,
  deleteFromCart,
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
  const publishTimeMs = new Date(publishTime).getTime();

  let pollCount = 0;
  let lastDbCancelCheck = Date.now();
  let lastCheckedAtDbUpdate = 0;
  let cartPreCleaned = false;

  // Auto pre-clean cart in background ONLY if scheduled well ahead of drop time (>15s before publishTime)
  const preCleanCart = async () => {
    if (cartPreCleaned || mode !== "AUTO_BUY" || !apiCredential) return;
    cartPreCleaned = true;
    try {
      console.log(`🧹 [PRE-CLEAN] Checking & pre-clearing cart for account...`);
      const existingCart = await getCartLists(domain, apiCredential);
      if (existingCart.items && existingCart.items.length > 0) {
        const idsToClear = existingCart.items.map((i) => i.id);
        await deleteFromCart(domain, idsToClear, apiCredential);
        console.log(`🧹 [PRE-CLEAN] Cleared ${idsToClear.length} old item(s) from cart.`);
      }
    } catch (e) {
      console.error(`⚠️ [PRE-CLEAN] Cart notice:`, e);
    }
  };

  if (publishTimeMs - Date.now() > 15000) {
    preCleanCart().catch(() => {});
  }

  // Log polling start
  await prisma.campaignLog.create({
    data: {
      campaignId,
      event: "POLLING_STARTED",
      detail: `Polling started. Timeout window: ${CAMPAIGN_TIMEOUT_MINUTES} minutes from start. Interval: ${pollingInterval}ms (Turbo enabled)`,
    },
  });

  // === POLLING LOOP ===
  while (true) {
    const now = Date.now();
    const diffFromPublish = publishTimeMs - now;
    const isCriticalDropWindow = diffFromPublish <= 20000 && diffFromPublish >= -60000;

    // Check cancellation periodically, but SKIP during the critical drop window for absolute zero DB overhead
    if (!isCriticalDropWindow && now - lastDbCancelCheck > 4000) {
      lastDbCancelCheck = now;
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });

      if (!campaign || campaign.status === "CANCELLED") {
        console.log(`⛔ Campaign ${campaignId} was cancelled or removed`);
        return;
      }
    }

    // Check timeout: 5 minutes from start of polling
    if (now > timeoutDate.getTime()) {
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
      // 1. Poll the lists API (Pure HTTP)
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

      // Only touch DB for stats when NOT in the critical drop window
      if (!isCriticalDropWindow) {
        if (now - lastCheckedAtDbUpdate > 5000) {
          lastCheckedAtDbUpdate = now;
          prisma.campaign.update({
            where: { id: campaignId },
            data: { lastCheckedAt: new Date() },
          }).catch(() => {});
        }

        if (pollCount % 20 === 1) {
          prisma.campaignLog.create({
            data: {
              campaignId,
              event: "POLL_ATTEMPT",
              detail: `Poll #${pollCount} — ${
                result.found ? "MATCH FOUND!" : "No match"
              }`,
            },
          }).catch(() => {});
        }
      }

      if (result.found && result.ids.length > 0) {
        // === MATCH FOUND ===
        const matchedIds = result.ids.slice(0, quantity);
        console.log(
          `⚡ [SNIPER] Campaign ${campaignId}: MATCH FOUND! (${matchedIds.length} cards: ${matchedIds.join(
            ", "
          )}) — 100% PURE HTTP FAST PIPELINE (ZERO DB DELAYS)!`
        );

        if (mode === "AUTO_BUY") {
          const pipelineStart = Date.now();

          // 1. ZERO DB OVERHEAD: Fire single batch addToCart IMMEDIATELY
          const buyResultPromise = addToCart(domain, matchedIds, apiCredential);

          // 2. OVERLAPPED PIPELINING:
          // Target server DB insert takes ~10-20ms. Fire getCartLists with 40ms stagger so it travels in parallel!
          const overlappedCartListsPromise = (async () => {
            await sleep(40);
            return getCartLists(domain, apiCredential);
          })();

          const buyResult = await buyResultPromise;
          console.log(`🛒 [SNIPER] AddCart done in ${Date.now() - pipelineStart}ms: ${buyResult.message}`);

          let targetCartIds: number[] = [];

          // FAST TRACK: Did addCart response contain the cart row IDs directly?
          if (buyResult.cartIds && buyResult.cartIds.length > 0) {
            targetCartIds = buyResult.cartIds;
            console.log(
              `⚡ [SNIPER] Direct Cart IDs extracted from addCart response in 0ms: [${targetCartIds.join(", ")}]`
            );
          } else {
            // Await the overlapped cart lists request that was traveling across the network
            let cartListsResult;
            try {
              cartListsResult = await overlappedCartListsPromise;
            } catch {
              cartListsResult = await getCartLists(domain, apiCredential);
            }
            console.log(
              `📋 [SNIPER] Overlapped CartLists returned in ${Date.now() - pipelineStart}ms (${cartListsResult?.items?.length || 0} items in cart)`
            );

            const resolveTargetCartIds = (items: typeof cartListsResult.items) => {
              if (!items || items.length === 0) return [];
              const matchedStrIds = matchedIds.map(String);
              const matchedNumIds = matchedIds.map(Number);

              const matchingItems = items.filter(
                (item) =>
                  matchedNumIds.includes(item.card_id) ||
                  matchedStrIds.includes(String(item.card_id))
              );

              if (matchingItems.length > 0) {
                return matchingItems.map((item) => item.id);
              }
              // If exact card_id did not map, take latest up to quantity items
              return items.slice(0, quantity).map((item) => item.id);
            };

            targetCartIds = resolveTargetCartIds(cartListsResult?.items || []);

            // SMART FAST-RETRY: If cart was empty (overlapped request arrived before server DB committed addCart),
            // retry up to 3 times rapidly (50ms, 80ms, 120ms)!
            let retryCount = 0;
            while (targetCartIds.length === 0 && retryCount < 3) {
              retryCount++;
              const retryDelay = retryCount * 50;
              console.log(
                `🔄 [SNIPER] Cart empty, retrying getCartLists #${retryCount}/3 after ${retryDelay}ms...`
              );
              await sleep(retryDelay);
              try {
                const freshCart = await getCartLists(domain, apiCredential);
                console.log(
                  `📋 [SNIPER] Retry #${retryCount} returned ${freshCart.items.length} items`
                );
                targetCartIds = resolveTargetCartIds(freshCart.items);
              } catch (retryErr) {
                console.error(`⚠️ Cart retry #${retryCount} error:`, retryErr);
              }
            }
          }

          if (targetCartIds.length === 0) {
            console.log(`⚠️ No cart items found to settle for campaign ${campaignId}`);
            updateCampaignStatus(
              campaignId,
              "FAILED",
              `Cart was empty after addCart. AddCart message: ${buyResult.message}`
            ).catch(console.error);
            return;
          }

          // 3. ZERO DB: Immediately fire settlement!
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
            apiCredential,
            2 // up to 2 retries on transient error
          );

          const totalPipelineMs = Date.now() - pipelineStart;
          console.log(
            `💳 [SNIPER] Settlement completed in ${Date.now() - settleStart}ms! Total execution time: ${totalPipelineMs}ms. Response: "${settleResult.message}"`
          );

          const isSuccess = settleResult.resCode === 1;

          // 4. NOW AND ONLY NOW: Save everything to database in the background!
          // (The product is already bought, so DB speed doesn't matter anymore)
          (async () => {
            try {
              await prisma.campaign.update({
                where: { id: campaignId },
                data: {
                  status: isSuccess ? "SUCCESS" : "FAILED",
                  matchedIds,
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

              // Refresh account balance in background
              const effectiveAccountId = accountId || campaignRecord.accountId;
              if (effectiveAccountId && apiCredential) {
                const memberInfo = await verifyMemberInfo(domain, apiCredential);
                if (memberInfo.valid && memberInfo.data) {
                  await prisma.account.update({
                    where: { id: effectiveAccountId },
                    data: {
                      balance: memberInfo.data.money,
                      remoteUsername: memberInfo.data.username || undefined,
                    },
                  });
                  await prisma.campaignLog.create({
                    data: {
                      campaignId,
                      event: "BALANCE_UPDATED",
                      detail: `Account balance updated: $${memberInfo.data.money}`,
                    },
                  });
                }
              }
            } catch (dbErr) {
              console.error("⚠️ Background DB sync notice:", dbErr);
            }
          })();
        } else {
          // CHECK_ONLY mode — save matched product IDs and mark SUCCESS
          console.log(
            `👁️ Campaign ${campaignId}: Check-only mode, product found`
          );
          prisma.campaign.update({
            where: { id: campaignId },
            data: {
              status: "SUCCESS",
              matchedIds,
              settlementMsg: "Products found in Check-Only mode",
            },
          }).catch(console.error);
          prisma.campaignLog.create({
            data: {
              campaignId,
              event: "CHECK_COMPLETE",
              detail: `Products found: ${matchedIds.join(", ")}`,
            },
          }).catch(console.error);
        }

        return; // Exit polling loop
      }
    } catch (pollError) {
      const errorMsg =
        pollError instanceof Error ? pollError.message : "Unknown poll error";
      console.error(
        `⚠️ Campaign ${campaignId}: Poll error — ${errorMsg}`
      );
    }

    // Dynamic Turbo Polling interval:
    // When within 15 seconds before publishTime up to 60 seconds after publishTime -> Turbo Polling (60ms)
    let sleepMs = pollingInterval;

    if (diffFromPublish <= 15000 && diffFromPublish >= -60000) {
      sleepMs = Math.min(pollingInterval, 60); // 60ms Turbo Polling
    }

    await sleep(sleepMs);
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

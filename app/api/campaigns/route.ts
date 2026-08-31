import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";

// GET /api/campaigns — list user's campaigns
export async function GET(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaigns = await prisma.campaign.findMany({
    where: { userId: authUser.userId },
    orderBy: { createdAt: "desc" },
    include: {
      account: {
        select: {
          id: true,
          name: true,
          remoteUsername: true,
          balance: true,
        },
      },
      _count: {
        select: { logs: true },
      },
    },
  });

  return Response.json({ campaigns });
}

// POST /api/campaigns — create a new campaign
export async function POST(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (authUser.status !== "APPROVED") {
    return Response.json(
      { error: "Your account is not approved" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const {
      accountId,
      domain,
      bins,
      minPrice,
      maxPrice,
      quantity,
      baseId,
      productDate,
      productEndDate,
      publishTime,
      mode,
      isCheck = 1,
    } = body;

    // Required validation: bins, quantity, publishTime
    if (!bins || !quantity || !publishTime) {
      return Response.json(
        {
          error:
            "Required fields: bins, quantity, publishTime",
        },
        { status: 400 }
      );
    }

    const parsedMinPrice =
      minPrice !== undefined && minPrice !== "" && minPrice !== null
        ? parseFloat(minPrice)
        : null;
    const parsedMaxPrice =
      maxPrice !== undefined && maxPrice !== "" && maxPrice !== null
        ? parseFloat(maxPrice)
        : null;
    const parsedBaseId =
      baseId !== undefined && baseId !== "" && baseId !== null
        ? baseId.toString().trim()
        : null;

    if (parsedMinPrice !== null && parsedMinPrice < 0) {
      return Response.json({ error: "Min price cannot be negative" }, { status: 400 });
    }
    if (parsedMaxPrice !== null && parsedMaxPrice < 0) {
      return Response.json({ error: "Max price cannot be negative" }, { status: 400 });
    }
    if (
      parsedMinPrice !== null &&
      parsedMaxPrice !== null &&
      parsedMinPrice > parsedMaxPrice
    ) {
      return Response.json(
        { error: "Min price cannot be greater than max price" },
        { status: 400 }
      );
    }

    if (parseInt(quantity) < 1) {
      return Response.json(
        { error: "Quantity must be at least 1" },
        { status: 400 }
      );
    }

    const publishDate = new Date(publishTime);
    if (isNaN(publishDate.getTime())) {
      return Response.json(
        { error: "Invalid publishTime format" },
        { status: 400 }
      );
    }

    // Resolve Account:
    // If accountId passed, use it. Otherwise use user's default account.
    let resolvedAccountId: string | null = null;
    let selectedAccount: {
      id: string;
      name: string;
      token: string;
      domain: string | null;
      balance: string | null;
    } | null = null;

    if (accountId) {
      selectedAccount = await prisma.account.findFirst({
        where: { id: accountId, userId: authUser.userId },
        select: { id: true, name: true, token: true, domain: true, balance: true },
      });
      if (selectedAccount) {
        resolvedAccountId = selectedAccount.id;
      }
    } else {
      selectedAccount = await prisma.account.findFirst({
        where: { userId: authUser.userId, isDefault: true },
        select: { id: true, name: true, token: true, domain: true, balance: true },
      });
      if (!selectedAccount) {
        selectedAccount = await prisma.account.findFirst({
          where: { userId: authUser.userId },
          select: { id: true, name: true, token: true, domain: true, balance: true },
        });
      }
      if (selectedAccount) {
        resolvedAccountId = selectedAccount.id;
      }
    }

    // Resolve domain with proper fallbacks
    let campaignDomain = domain?.trim() || null;
    if (!campaignDomain && selectedAccount?.domain) {
      campaignDomain = selectedAccount.domain;
    }
    if (!campaignDomain) {
      const user = await prisma.user.findUnique({
        where: { id: authUser.userId },
        select: { defaultDomain: true },
      });
      campaignDomain = user?.defaultDomain || "https://api.pepecards2f7z1qtyyg.top";
    }

    const campaign = await prisma.campaign.create({
      data: {
        userId: authUser.userId,
        accountId: resolvedAccountId,
        domain: campaignDomain,
        bins: bins.trim(),
        minPrice: parsedMinPrice,
        maxPrice: parsedMaxPrice,
        quantity: parseInt(quantity),
        baseId: parsedBaseId,
        productDate: productDate ? String(productDate).trim() : null,
        productEndDate: productEndDate ? String(productEndDate).trim() : null,
        publishTime: publishDate,
        mode: "AUTO_BUY",
        isCheck: Number(isCheck) === 2 ? 2 : 1,
        status: "SCHEDULED",
      },
      include: {
        account: {
          select: {
            id: true,
            name: true,
            remoteUsername: true,
            balance: true,
          },
        },
      },
    });

    // Create initial log entry
    await prisma.campaignLog.create({
      data: {
        campaignId: campaign.id,
        event: "CAMPAIGN_CREATED",
        detail: `Campaign created in ${campaign.mode} mode${
          selectedAccount ? ` with account [${selectedAccount.name}]` : ""
        }. Publish time: ${publishDate.toISOString()}`,
      },
    });

    return Response.json({ campaign }, { status: 201 });
  } catch (error) {
    console.error("Campaign creation error:", error);
    return Response.json(
      { error: "Failed to create campaign" },
      { status: 500 }
    );
  }
}

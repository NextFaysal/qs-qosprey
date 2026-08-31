import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";
import type { NextRequest } from "next/server";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/campaigns/[id] — get campaign details
export async function GET(
  request: NextRequest,
  ctx: RouteParams
) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
      userId: authUser.userId,
    },
    include: {
      logs: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  return Response.json({ campaign });
}

// PATCH /api/campaigns/[id] — update campaign (only if SCHEDULED)
export async function PATCH(
  request: NextRequest,
  ctx: RouteParams
) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  // Find campaign and verify ownership
  const existing = await prisma.campaign.findFirst({
    where: { id, userId: authUser.userId },
  });

  if (!existing) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (existing.status !== "SCHEDULED") {
    return Response.json(
      { error: "Can only edit campaigns that are still SCHEDULED" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    if (body.accountId !== undefined) updateData.accountId = body.accountId || null;
    if (body.domain !== undefined) updateData.domain = body.domain?.trim() || null;
    if (body.bins !== undefined) updateData.bins = body.bins.trim();
    if (body.minPrice !== undefined)
      updateData.minPrice =
        body.minPrice !== "" && body.minPrice !== null && !isNaN(Number(body.minPrice))
          ? parseFloat(body.minPrice)
          : null;
    if (body.maxPrice !== undefined)
      updateData.maxPrice =
        body.maxPrice !== "" && body.maxPrice !== null && !isNaN(Number(body.maxPrice))
          ? parseFloat(body.maxPrice)
          : null;
    if (body.quantity !== undefined) updateData.quantity = parseInt(body.quantity);
    if (body.baseId !== undefined)
      updateData.baseId =
        body.baseId !== "" && body.baseId !== null ? body.baseId.toString().trim() : null;
    if (body.publishTime !== undefined) updateData.publishTime = new Date(body.publishTime);
    if (body.productDate !== undefined)
      updateData.productDate =
        body.productDate !== "" && body.productDate !== null
          ? body.productDate.toString().trim()
          : null;
    if (body.productEndDate !== undefined)
      updateData.productEndDate =
        body.productEndDate !== "" && body.productEndDate !== null
          ? body.productEndDate.toString().trim()
          : null;
    if (body.isCheck !== undefined) updateData.isCheck = Number(body.isCheck) === 2 ? 2 : 1;

    const campaign = await prisma.campaign.update({
      where: { id },
      data: updateData,
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

    return Response.json({ campaign });
  } catch (error) {
    console.error("Campaign update error:", error);
    return Response.json(
      { error: "Failed to update campaign" },
      { status: 500 }
    );
  }
}

// DELETE /api/campaigns/[id] — cancel or delete a campaign
export async function DELETE(
  request: NextRequest,
  ctx: RouteParams
) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const permanent = searchParams.get("permanent") === "true";

  const existing = await prisma.campaign.findFirst({
    where: { id, userId: authUser.userId },
  });

  if (!existing) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  // If permanent delete requested, or if already finished/cancelled, delete row from DB
  if (permanent || ["SUCCESS", "FAILED", "EXPIRED", "CANCELLED"].includes(existing.status)) {
    await prisma.campaign.delete({
      where: { id },
    });
    return Response.json({ message: "Campaign deleted permanently" });
  }

  // Otherwise cancel active campaign
  const campaign = await prisma.campaign.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  await prisma.campaignLog.create({
    data: {
      campaignId: id,
      event: "CAMPAIGN_CANCELLED",
      detail: "Campaign cancelled by user",
    },
  });

  return Response.json({ campaign });
}


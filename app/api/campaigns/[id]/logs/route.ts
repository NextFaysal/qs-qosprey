import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";
import type { NextRequest } from "next/server";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/campaigns/[id]/logs — get campaign logs
export async function GET(
  request: NextRequest,
  ctx: RouteParams
) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  // Verify ownership
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: authUser.userId },
    select: { id: true },
  });

  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = parseInt(url.searchParams.get("pageSize") || "50");

  const [logs, total] = await Promise.all([
    prisma.campaignLog.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.campaignLog.count({
      where: { campaignId: id },
    }),
  ]);

  return Response.json({
    logs,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

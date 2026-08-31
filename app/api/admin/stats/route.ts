import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";

// GET /api/admin/stats — dashboard stats for admin
export async function GET(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser || authUser.role !== "ADMIN") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const [
    totalUsers,
    pendingUsers,
    approvedUsers,
    rejectedUsers,
    totalCampaigns,
    activeCampaigns,
    successCampaigns,
    failedCampaigns,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { status: "APPROVED" } }),
    prisma.user.count({ where: { status: "REJECTED" } }),
    prisma.campaign.count(),
    prisma.campaign.count({ where: { status: { in: ["SCHEDULED", "POLLING"] } } }),
    prisma.campaign.count({ where: { status: "SUCCESS" } }),
    prisma.campaign.count({ where: { status: "FAILED" } }),
  ]);

  return Response.json({
    users: { total: totalUsers, pending: pendingUsers, approved: approvedUsers, rejected: rejectedUsers },
    campaigns: { total: totalCampaigns, active: activeCampaigns, success: successCampaigns, failed: failedCampaigns },
  });
}

import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";

export async function GET(request: Request) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: authUser.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      defaultDomain: true,
      createdAt: true,
    },
  });

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  if (user.role !== "ADMIN" && user.status !== "APPROVED") {
    return Response.json(
      {
        error: "আপনার একাউন্ট এখনো এপ্রুভ করা হয়নি অথবা সাসপেন্ড করা হয়েছে।",
        status: user.status,
      },
      { status: 403 }
    );
  }

  return Response.json({ user });
}

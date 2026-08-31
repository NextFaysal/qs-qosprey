import { prisma } from "@/app/_lib/db";
import { getAuthUser } from "@/app/_lib/auth";
import { getCartLists, deleteFromCart } from "@/worker/http-client";
import type { NextRequest } from "next/server";

// GET /api/cart?accountId=... - Get live items in cart for selected account
export async function GET(request: NextRequest) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");

  let account;
  if (accountId) {
    account = await prisma.account.findFirst({
      where: { id: accountId, userId: authUser.userId },
    });
  } else {
    account = await prisma.account.findFirst({
      where: { userId: authUser.userId, isDefault: true },
    }) || await prisma.account.findFirst({
      where: { userId: authUser.userId },
    });
  }

  if (!account) {
    return Response.json({ error: "No account found" }, { status: 404 });
  }

  const domain = account.domain || "https://api.pepecards2f7z1qtyyg.top";

  try {
    const result = await getCartLists(domain, account.token);
    return Response.json({
      success: true,
      account: {
        id: account.id,
        name: account.name,
        username: account.remoteUsername,
      },
      items: result.items || [],
      total: result.items?.length || 0,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch cart",
      },
      { status: 500 }
    );
  }
}

// DELETE /api/cart - Delete items from cart
export async function DELETE(request: NextRequest) {
  const authUser = getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const idsParam = url.searchParams.get("ids"); // comma separated cart row IDs, or empty to clear all

  let account;
  if (accountId) {
    account = await prisma.account.findFirst({
      where: { id: accountId, userId: authUser.userId },
    });
  } else {
    account = await prisma.account.findFirst({
      where: { userId: authUser.userId, isDefault: true },
    }) || await prisma.account.findFirst({
      where: { userId: authUser.userId },
    });
  }

  if (!account) {
    return Response.json({ error: "No account found" }, { status: 404 });
  }

  const domain = account.domain || "https://api.pepecards2f7z1qtyyg.top";

  try {
    let idsToDelete: string[] = [];

    if (idsParam && idsParam.trim()) {
      idsToDelete = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      // Clear ALL items in cart
      const currentCart = await getCartLists(domain, account.token);
      idsToDelete = (currentCart.items || []).map((i) => String(i.id));
    }

    if (idsToDelete.length === 0) {
      return Response.json({ message: "Cart is already empty" });
    }

    const delResult = await deleteFromCart(domain, idsToDelete, account.token);
    return Response.json({
      success: delResult.success,
      message: delResult.message,
      deletedIds: idsToDelete,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to remove from cart",
      },
      { status: 500 }
    );
  }
}

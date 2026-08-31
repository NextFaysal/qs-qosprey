import "dotenv/config";

const POLLING_INTERVAL_MS = parseInt(
  process.env.POLLING_INTERVAL_MS || "500",
  10
);

// HTTP Agent headers builder
export function buildHeaders(apiCredential?: string): Record<string, string> {
  const reqHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  };

  if (apiCredential) {
    const trimmed = apiCredential.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const custom = JSON.parse(trimmed);
        Object.assign(reqHeaders, custom);
      } catch {
        reqHeaders["token"] = trimmed;
        reqHeaders["Authorization"] = `Bearer ${trimmed}`;
      }
    } else if (trimmed.includes("=") && !trimmed.startsWith("Bearer ")) {
      reqHeaders["Cookie"] = trimmed;
    } else if (trimmed.startsWith("Bearer ")) {
      reqHeaders["Authorization"] = trimmed;
      reqHeaders["token"] = trimmed.replace(/^Bearer\s+/i, "").trim();
    } else {
      reqHeaders["token"] = trimmed;
      reqHeaders["Authorization"] = `Bearer ${trimmed}`;
    }
  }

  return reqHeaders;
}

export const DEFAULT_PEPE_DOMAIN = "https://api.pepecards2f7z1qtyyg.top";

/**
 * Verify member token against member info endpoint
 */
export async function verifyMemberInfo(
  domain: string,
  token: string
): Promise<{
  valid: boolean;
  message: string;
  data?: {
    id: number;
    username: string;
    nickname: string;
    money: string;
    cart_num?: number;
  };
}> {
  const normalizedDomain = (domain || DEFAULT_PEPE_DOMAIN).replace(/\/+$/, "");
  const url = `${normalizedDomain}/v1/member/info`;
  const headers = buildHeaders(token);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        valid: false,
        message: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const json = await response.json();
    if (json.ResCode === 1 && json.ResData) {
      return {
        valid: true,
        message: json.MessageText || "ok",
        data: {
          id: Number(json.ResData.id || json.ResData.user_id),
          username: String(json.ResData.username || json.ResData.nickname || "User"),
          nickname: String(json.ResData.nickname || ""),
          money: String(json.ResData.money ?? "0"),
          cart_num: json.ResData.cart_num,
        },
      };
    }

    return {
      valid: false,
      message: json.MessageText || "Invalid token or unauthorized",
    };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : "Network request failed",
    };
  }
}


/**
 * Extract YYYY-MM-DD date from sname (e.g. "2026_08_31_US_FR_CA" -> "2026-08-31")
 */
export function parseSnameDate(sname?: string | null): string | null {
  if (!sname) return null;
  const match = sname.match(/(\d{4})[_/-](\d{2})[_/-](\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return null;
}

/**
 * Poll the goods/lists API to search for products
 */
export async function pollGoodsList(
  domain: string,
  params: {
    bins: string;
    minPrice?: number | null;
    maxPrice?: number | null;
    baseId?: string | null;
    productDate?: string | null;
    productEndDate?: string | null;
  },
  apiCredential?: string
): Promise<{ found: boolean; ids: string[]; raw?: unknown }> {
  const url = `${domain}/v1/goods/lists`;
  const headers = buildHeaders(apiCredential);

  // Dynamically build payload: omit min_price, max_price, base_id if not provided
  const payload: Record<string, unknown> = {
    page: 1,
    pageSize: 10,
    bins: params.bins.trim(),
  };

  if (
    params.minPrice !== undefined &&
    params.minPrice !== null &&
    !isNaN(Number(params.minPrice))
  ) {
    payload.min_price = Number(params.minPrice);
  }

  if (
    params.maxPrice !== undefined &&
    params.maxPrice !== null &&
    !isNaN(Number(params.maxPrice))
  ) {
    payload.max_price = Number(params.maxPrice);
  }

  if (
    params.baseId !== undefined &&
    params.baseId !== null &&
    String(params.baseId).trim() !== ""
  ) {
    const trimmed = String(params.baseId).trim();
    payload.base_id = isNaN(Number(trimmed)) ? trimmed : Number(trimmed);
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Check if response has data array (Target API returns: ResData.data)
    let rawList: Array<{ id?: string | number; Id?: string | number; sname?: string }> = [];
    if (data?.ResData?.data && Array.isArray(data.ResData.data)) {
      rawList = data.ResData.data;
    } else if (data?.ResData && Array.isArray(data.ResData)) {
      rawList = data.ResData;
    } else if (data?.data && Array.isArray(data.data)) {
      rawList = data.data;
    }

    if (rawList.length > 0) {
      // Condition: Filter strictly by sname date if productDate is specified!
      if (params.productDate && String(params.productDate).trim() !== "") {
        const minDate = String(params.productDate).replace(/_/g, "-").trim();
        const maxDate = params.productEndDate
          ? String(params.productEndDate).replace(/_/g, "-").trim()
          : null;

        rawList = rawList.filter((item) => {
          const itemDate = parseSnameDate(item.sname);
          if (!itemDate) return false;
          if (itemDate < minDate) return false;
          if (maxDate && itemDate > maxDate) return false;
          return true;
        });
      }

      const ids = rawList
        .map((item) => String(item.id || item.Id))
        .filter(Boolean);

      if (ids.length > 0) {
        return { found: true, ids, raw: data };
      }
    }

    return { found: false, ids: [], raw: data };
  } catch (error) {
    throw new Error(
      `Poll failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Add a single product to cart: POST /v1/goods/addCart with { id: productId }
 */
export async function addToCartSingle(
  domain: string,
  id: string | number,
  apiCredential?: string
): Promise<{ success: boolean; id: string; resCode?: number; message?: string; raw?: unknown }> {
  const url = `${domain}/v1/goods/addCart`;
  const headers = buildHeaders(apiCredential);
  const numericId = Number(id);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: isNaN(numericId) ? id : numericId }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, id: String(id), message: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return {
      success: data.ResCode === 1 || data.ResCode === 1002, // 1 = ok, 1002 = already in cart
      id: String(id),
      resCode: data.ResCode,
      message: data.MessageText || "Unknown response",
      raw: data,
    };
  } catch (error) {
    return {
      success: false,
      id: String(id),
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Add multiple products to cart concurrently one-by-one
 */
export async function addToCart(
  domain: string,
  ids: string[],
  apiCredential?: string
): Promise<{
  success: boolean;
  resCode?: number;
  message: string;
  results: Array<{ success: boolean; id: string; resCode?: number; message?: string }>;
  successCount: number;
}> {
  // Fire all addCart requests concurrently in parallel
  const results = await Promise.all(
    ids.map((id) => addToCartSingle(domain, id, apiCredential))
  );

  const successCount = results.filter((r) => r.success).length;
  const firstSuccessful = results.find((r) => r.success);
  const summaryMsg = results.map((r) => `#${r.id}: ${r.message}`).join(", ");

  return {
    success: successCount > 0,
    resCode: firstSuccessful?.resCode || (successCount > 0 ? 1 : 1001),
    message: `${successCount}/${ids.length} added to cart (${summaryMsg})`,
    results,
    successCount,
  };
}

export interface CartItemData {
  id: number;
  card_id: number;
  user_id?: number;
  createtime?: number;
}

/**
 * Fetch items in the cart
 * POST /v1/goods/cartLists
 */
export async function getCartLists(
  domain: string,
  apiCredential?: string
): Promise<{ success: boolean; items: CartItemData[]; raw?: unknown }> {
  const url = `${domain.replace(/\/+$/, "")}/v1/goods/cartLists`;
  const headers = buildHeaders(apiCredential);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();
    const items: CartItemData[] = [];

    if (json.ResCode === 1 && json.ResData?.data && Array.isArray(json.ResData.data)) {
      for (const item of json.ResData.data) {
        items.push({
          id: Number(item.id),
          card_id: Number(item.card_id),
          user_id: item.user_id ? Number(item.user_id) : undefined,
          createtime: item.createtime ? Number(item.createtime) : undefined,
        });
      }
    }

    return {
      success: json.ResCode === 1,
      items,
      raw: json,
    };
  } catch (error) {
    throw new Error(
      `Fetch cart lists failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Settle/Order Cart Items
 * POST /v1/goods/settlement
 * Body: { ids: "4497726,4497723", is_check: 1 }
 */
export async function settleCart(
  domain: string,
  cartRowIds: (string | number)[],
  isCheck: number = 1,
  apiCredential?: string
): Promise<{ success: boolean; resCode: number; message: string; raw?: unknown }> {
  const url = `${domain.replace(/\/+$/, "")}/v1/goods/settlement`;
  const headers = buildHeaders(apiCredential);

  const payload = {
    ids: cartRowIds.map(String).join(","),
    is_check: isCheck === 2 ? 2 : 1,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();

    return {
      success: json.ResCode === 1,
      resCode: Number(json.ResCode),
      message: String(json.MessageText || "No response message"),
      raw: json,
    };
  } catch (error) {
    throw new Error(
      `Settlement failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Remove items from cart: POST /v1/goods/delCart
 */
export async function deleteFromCart(
  domain: string,
  cartRowIds: Array<string | number>,
  apiCredential?: string
): Promise<{ success: boolean; resCode?: number; message?: string }> {
  const url = `${domain.replace(/\/+$/, "")}/v1/goods/delCart`;
  const headers = buildHeaders(apiCredential);
  const idsStr = cartRowIds.map(String).join(",");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ids: idsStr }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      success: data.ResCode === 1,
      resCode: Number(data.ResCode),
      message: String(data.MessageText || "Unknown response"),
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Delete from cart failed",
    };
  }
}

/**
 * Get the polling interval
 */
export function getPollingInterval(): number {
  return POLLING_INTERVAL_MS;
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


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
    Connection: "keep-alive",
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
      keepalive: true,
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
      keepalive: true,
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
): Promise<{
  success: boolean;
  id: string;
  resCode?: number;
  message?: string;
  raw?: unknown;
  cartId?: number;
}> {
  const url = `${domain}/v1/goods/addCart`;
  const headers = buildHeaders(apiCredential);
  const numericId = Number(id);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: isNaN(numericId) ? id : numericId }),
      keepalive: true,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, id: String(id), message: `HTTP ${response.status}` };
    }

    const data = await response.json();

    // Inspect if target API returns the newly created cart row ID in ResData
    let cartId: number | undefined;
    if (data?.ResData) {
      if (typeof data.ResData === "number" && data.ResData > 0) {
        cartId = data.ResData;
      } else if (typeof data.ResData === "string" && !isNaN(Number(data.ResData))) {
        cartId = Number(data.ResData);
      } else if (typeof data.ResData === "object") {
        if (data.ResData.id && !isNaN(Number(data.ResData.id))) {
          cartId = Number(data.ResData.id);
        } else if (data.ResData.cart_id && !isNaN(Number(data.ResData.cart_id))) {
          cartId = Number(data.ResData.cart_id);
        }
      }
    }

    return {
      success: data.ResCode === 1 || data.ResCode === 1002, // 1 = ok, 1002 = already in cart
      id: String(id),
      resCode: data.ResCode,
      message: data.MessageText || "Unknown response",
      raw: data,
      cartId,
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
 * Add products to cart in a single batch request: POST /v1/goods/addCart
 * Body: { id: "39133352,39133358,39133362" }
 */
export async function addToCart(
  domain: string,
  ids: (string | number)[],
  apiCredential?: string
): Promise<{
  success: boolean;
  resCode?: number;
  message: string;
  ids: string[];
  raw?: unknown;
  cartIds: number[];
}> {
  const cleanIds = ids.map(String).map((s) => s.trim()).filter(Boolean);
  if (cleanIds.length === 0) {
    return {
      success: false,
      message: "No IDs provided",
      ids: [],
      cartIds: [],
    };
  }

  const url = `${domain.replace(/\/+$/, "")}/v1/goods/addCart`;
  const headers = buildHeaders(apiCredential);
  const idsPayload = cleanIds.join(",");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: idsPayload }),
      keepalive: true,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        success: false,
        message: `HTTP ${response.status}: ${response.statusText}`,
        ids: cleanIds,
        cartIds: [],
      };
    }

    const data = await response.json();
    const isSuccess = data.ResCode === 1 || data.ResCode === 1002; // 1 = ok, 1002 = already in cart

    // Inspect if target API returns newly created cart row IDs in ResData
    const cartIds: number[] = [];
    if (data?.ResData) {
      if (typeof data.ResData === "number" && data.ResData > 0) {
        cartIds.push(data.ResData);
      } else if (typeof data.ResData === "string") {
        data.ResData.split(",").forEach((s: string) => {
          const num = Number(s.trim());
          if (!isNaN(num) && num > 0) cartIds.push(num);
        });
      } else if (Array.isArray(data.ResData)) {
        data.ResData.forEach((item: any) => {
          const cid = typeof item === "object" ? Number(item?.id || item?.cart_id) : Number(item);
          if (!isNaN(cid) && cid > 0) cartIds.push(cid);
        });
      } else if (typeof data.ResData === "object") {
        if (data.ResData.id && !isNaN(Number(data.ResData.id))) {
          cartIds.push(Number(data.ResData.id));
        } else if (data.ResData.cart_id && !isNaN(Number(data.ResData.cart_id))) {
          cartIds.push(Number(data.ResData.cart_id));
        }
      }
    }

    return {
      success: isSuccess,
      resCode: Number(data.ResCode),
      message: data.MessageText || (isSuccess ? "Operation completed" : "Failed to add to cart"),
      ids: cleanIds,
      raw: data,
      cartIds,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      ids: cleanIds,
      cartIds: [],
    };
  }
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
      keepalive: true,
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
 * Includes zero-delay retry for high-speed reliability
 */
export async function settleCart(
  domain: string,
  cartRowIds: (string | number)[],
  isCheck: number = 1,
  apiCredential?: string,
  maxRetries: number = 2
): Promise<{ success: boolean; resCode: number; message: string; raw?: unknown }> {
  const url = `${domain.replace(/\/+$/, "")}/v1/goods/settlement`;
  const headers = buildHeaders(apiCredential);

  const payload = {
    ids: cartRowIds.map(String).join(","),
    is_check: isCheck === 2 ? 2 : 1,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        keepalive: true,
        signal: AbortSignal.timeout(10000),
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
      lastError = error;
      if (attempt < maxRetries) {
        // Instant retry without delay!
        continue;
      }
    }
  }

  throw new Error(
    `Settlement failed after retries: ${lastError instanceof Error ? lastError.message : "Unknown error"}`
  );
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


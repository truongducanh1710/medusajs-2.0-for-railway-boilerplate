import { apiFetch } from "../../lib/api-client";
import type {
  ProductTestCaseRecord,
  ProductTestDailyResult,
  ProductTestFacets,
  ProductTestFilters,
  ProductTestListResponse,
  ProductTestProposal,
  ProductTestPurchaseCheck,
} from "./types";

type CaseDetailResponse = {
  case: ProductTestCaseRecord;
  summary: ProductTestListResponse["cases"][number];
  available_actions: Array<{ id: string; next_status: string | null }>;
  permissions: {
    can_view_all: boolean;
    can_edit_marketing: boolean;
    can_edit_purchase: boolean;
    can_approve: boolean;
    can_reassign: boolean;
  };
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init);
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(
      data?.error || data?.message || `HTTP ${response.status}`,
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function createProductTestingClient() {
  async function list(filters: Partial<ProductTestFilters> = {}) {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.marketer) query.set("marketer", filters.marketer);
    if (filters.assignee) query.set("owner", filters.assignee);
    if (filters.status) query.set("status", filters.status);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    return requestJson<ProductTestListResponse>(
      `/admin/product-tests?${query.toString()}`,
    );
  }

  async function get(id: string) {
    return requestJson<CaseDetailResponse>(`/admin/product-tests/${id}`);
  }

  async function getDailyResults(id: string) {
    return requestJson<{ daily_results: ProductTestDailyResult[] }>(
      `/admin/product-tests/${id}/daily-results`,
    );
  }

  async function getFacets() {
    return requestJson<ProductTestFacets>("/admin/product-tests/facets");
  }

  async function createCase(payload: {
    product_name: string;
    product_handle?: string;
  }) {
    return requestJson<{ case: ProductTestCaseRecord }>(
      "/admin/product-tests",
      jsonInit("POST", payload),
    );
  }

  async function updateCase(
    id: string,
    payload: {
      product_name?: string;
      product_handle?: string;
      // Sending an empty string clears the assignment; omitting the key
      // leaves it untouched.
      purchaser_email?: string | null;
      purchaser_name?: string | null;
      version: number;
    },
  ) {
    return requestJson<{ case: ProductTestCaseRecord }>(
      `/admin/product-tests/${id}`,
      jsonInit("PATCH", payload),
    );
  }

  async function listPurchasers() {
    return requestJson<{ purchasers: Array<{ email: string; name: string }> }>(
      "/admin/product-tests/purchasers",
    );
  }

  async function deleteCase(id: string) {
    return requestJson<{ deleted: true }>(`/admin/product-tests/${id}`, {
      method: "DELETE",
    });
  }

  async function updatePurchaseCheck(
    id: string,
    payload: Partial<ProductTestPurchaseCheck> & { version: number },
  ) {
    return requestJson<{
      purchase_check: ProductTestPurchaseCheck;
      version: number;
    }>(`/admin/product-tests/${id}/purchase-check`, jsonInit("PUT", payload));
  }

  async function updateProposal(
    id: string,
    payload: Partial<ProductTestProposal> & { version: number },
  ) {
    return requestJson<{ proposal: ProductTestProposal; version: number }>(
      `/admin/product-tests/${id}/proposal`,
      jsonInit("PUT", payload),
    );
  }

  async function createDailyResult(
    id: string,
    payload: Partial<ProductTestDailyResult> & {
      test_date: string;
      version: number;
    },
  ) {
    return requestJson<{
      daily_result: ProductTestDailyResult;
      version: number;
    }>(`/admin/product-tests/${id}/daily-results`, jsonInit("POST", payload));
  }

  async function updateDailyResult(
    id: string,
    resultId: string,
    payload: Partial<ProductTestDailyResult> & {
      version: number;
      test_date: string;
    },
  ) {
    return requestJson<{ daily_result: ProductTestDailyResult }>(
      `/admin/product-tests/${id}/daily-results/${resultId}`,
      jsonInit("PATCH", payload),
    );
  }

  async function evaluateDailyResult(
    id: string,
    resultId: string,
    payload: { evaluation: string; leader_note: string; version: number },
  ) {
    return requestJson<{ daily_result: ProductTestDailyResult }>(
      `/admin/product-tests/${id}/daily-results/${resultId}/evaluate`,
      jsonInit("POST", payload),
    );
  }

  async function transitionCase(
    id: string,
    payload: {
      action: string;
      comment?: string;
      version: number;
    },
  ) {
    return requestJson<{
      case: ProductTestCaseRecord;
      action: string;
      version: number;
    }>(`/admin/product-tests/${id}/actions`, jsonInit("POST", payload));
  }

  async function uploadImages(files: File[]) {
    const formData = new FormData();
    for (const file of files) formData.append("files", file);
    const response = await apiFetch("/admin/uploads", {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        data?.message || `Upload thất bại: HTTP ${response.status}`,
      );
    const urls: string[] = [];
    for (const collection of [data?.files, data?.uploads]) {
      if (!Array.isArray(collection)) continue;
      for (const file of collection)
        if (file?.url || file?.location) urls.push(file.url || file.location);
    }
    if (data?.url) urls.push(data.url);
    return urls;
  }

  return {
    list,
    get,
    getDailyResults,
    getFacets,
    createCase,
    updateCase,
    deleteCase,
    listPurchasers,
    updatePurchaseCheck,
    updateProposal,
    createDailyResult,
    updateDailyResult,
    evaluateDailyResult,
    transitionCase,
    uploadImages,
  };
}

export type ProductTestingClient = ReturnType<
  typeof createProductTestingClient
>;

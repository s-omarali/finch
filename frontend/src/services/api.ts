/**
 * Real API client — calls the FastAPI backend.
 * Swap imports from mockApi to this file when the backend is running.
 *
 * Auth: each request attaches the Supabase JWT so FastAPI can verify identity.
 */

import { mockDeductions, mockOptimizationSignals, mockTransactions } from "../data/mockData";
import { getAuthHeaders } from "./supabaseClient";
import type {
  DashboardResponse,
  FilingPreparationPayload,
  FilingRunStartPayload,
  OnboardingPayload,
  OptimizationMileagePayload,
  OptimizationMileageResult,
  PlaidExchangeRequest,
  PlaidExchangeResponse,
  PlaidLinkTokenResponse,
  PlaidSyncResponse,
  ReceiptScanResponse,
} from "../types/api";
import type { FilingProfile, FilingRun, IntegrationConnection, UserProfile } from "../types/domain";

const DEFAULT_BASE_URL = "https://hackmsa-2026-production.up.railway.app";

function resolveApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
  if (!configured) return DEFAULT_BASE_URL;

  const normalized = configured.replace(/\/+$/, "");
  if (typeof window === "undefined") return normalized;

  const isRemotePage = window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
  const pointsToLocal = /localhost|127\.0\.0\.1|\.railway\.internal/i.test(normalized);
  const insecureOnHttps = window.location.protocol === "https:" && normalized.startsWith("http://");

  if ((isRemotePage && pointsToLocal) || insecureOnHttps) {
    return DEFAULT_BASE_URL;
  }

  return normalized;
}

const BASE_URL = resolveApiBaseUrl();

async function requestWithAuth(path: string, init: RequestInit, forceRefresh = false): Promise<Response> {
  const authHeaders = await getAuthHeaders(forceRefresh);
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(init.headers ?? {}),
    },
  });
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await requestWithAuth(path, init, false);
  if (res.status === 401) {
    res = await requestWithAuth(path, init, true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function getCurrentUser(): Promise<UserProfile> {
  const data = await apiFetch<any>("/api/v1/me");
  return {
    id: data.id,
    fullName: data.full_name ?? "",
    email: data.email ?? "",
    gigs: data.gigs ?? [],
    state: data.state ?? "TX",
    estimatedAnnualIncome: 0,
    estimatedMarginalTaxRate: data.estimated_marginal_tax_rate ?? 0.24,
    onboardingCompleted: data.onboarding_completed ?? false,
  };
}
export async function getPlaidTestUserData(): Promise<DashboardResponse>
{
  const resp = await apiFetch<DashboardResponse>("/api/v1/plaid-test-dashboard");
  return resp;
}
export async function getDashboardData(): Promise<DashboardResponse> {
  const real = await apiFetch<DashboardResponse>("/api/v1/dashboard");

  // Merge real transactions on top of mock ones — real takes priority
  const realIds = new Set(real.transactions.map((t) => t.id));
  const mergedTransactions = [
    ...real.transactions,
    ...mockTransactions.filter((t) => !realIds.has(t.id)),
  ];

  const mergedDeductions = real.deductions.length > 0 ? real.deductions : mockDeductions;
  const mergedSignals = real.optimizationSignals.length > 0 ? real.optimizationSignals : mockOptimizationSignals;

  const totalIncome = mergedTransactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);
  const totalDeductions = mergedDeductions.reduce((sum, d) => sum + (d.potentialSavings ?? 0), 0);

  return {
    metrics: {
      totalIncome: real.metrics.totalIncome > 0 ? real.metrics.totalIncome : totalIncome,
      estimatedTaxLiability: real.metrics.estimatedTaxLiability > 0 ? real.metrics.estimatedTaxLiability : Math.round(totalIncome * 0.24),
      totalDeductionsFound: totalDeductions,
    },
    transactions: mergedTransactions,
    deductions: mergedDeductions,
    optimizationSignals: mergedSignals,
  };
}

export async function saveOnboarding(
  payload: OnboardingPayload
): Promise<{ profile: UserProfile; integrations: IntegrationConnection[] }> {
  return apiFetch("/api/v1/onboarding", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function scanReceiptFile(file: File): Promise<ReceiptScanResponse> {
  const authHeaders = await getAuthHeaders();
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${BASE_URL}/api/v1/receipts/scan`, {
    method: "POST",
    headers: authHeaders,
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Receipt scan failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<ReceiptScanResponse>;
}

export async function getOptimizationMileage(
  payload: OptimizationMileagePayload
): Promise<OptimizationMileageResult> {
  return apiFetch<OptimizationMileageResult>("/api/v1/optimization/mileage", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function saveFilingPreparation(
  payload: FilingPreparationPayload
): Promise<{ saved: true; profile: FilingPreparationPayload }> {
  return apiFetch("/api/v1/filing/preparation", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function startFilingRun(payload: FilingRunStartPayload): Promise<FilingRun> {
  return apiFetch<FilingRun>("/api/v1/filing/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getFilingPreparationDefaults(): Promise<FilingProfile> {
  return apiFetch<FilingProfile>("/api/v1/filing/preparation/defaults");
}

export async function approveCurrentFilingStep(run: FilingRun): Promise<FilingRun> {
  const nextIndex = run.currentStepIndex + 1;
  const updatedSteps = run.steps.map((step, index) => {
    if (index === run.currentStepIndex) return { ...step, status: "completed" as const };
    if (index === nextIndex) return { ...step, status: "ready_for_approval" as const };
    return step;
  });
  const complete = nextIndex >= run.steps.length;
  return {
    ...run,
    steps: updatedSteps,
    currentStepIndex: complete ? run.steps.length - 1 : nextIndex,
    status: complete ? "completed" : "awaiting_user",
  };
}

export async function getIntegrationDefaults(): Promise<IntegrationConnection[]> {
  return apiFetch<IntegrationConnection[]>("/api/v1/integrations/defaults");
}

export async function createPlaidLinkToken(): Promise<PlaidLinkTokenResponse> {
  return apiFetch<PlaidLinkTokenResponse>("/api/v1/plaid/link-token", { method: "POST" });
}

export async function exchangePlaidPublicToken(payload: PlaidExchangeRequest): Promise<PlaidExchangeResponse> {
  return apiFetch<PlaidExchangeResponse>("/api/v1/plaid/exchange", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function syncAllPlaidTransactions(): Promise<PlaidSyncResponse> {
  return apiFetch<PlaidSyncResponse>("/api/v1/plaid/sync", { method: "POST" });
}

import {
  avgGasPriceByState2025,
  estimateAnnualIncomeFromGigs,
  getMockOptimizationSignals,
  getMockTransactionsForGigs,
  mockDeductions,
  mockFilingProfile,
  mockFilingRun,
  mockIntegrations,
  mockMetrics,
  mockUser,
} from "../data/mockData";
import type {
  DashboardResponse,
  FilingPreparationPayload,
  FilingRunStartPayload,
  OptimizationMileagePayload,
  OptimizationMileageResult,
  OnboardingPayload,
  PlaidExchangeRequest,
  PlaidExchangeResponse,
  PlaidLinkTokenResponse,
  PlaidSyncResponse,
  ReceiptScanResponse,
} from "../types/api";
import type { DashboardMetrics, FilingRun, IntegrationConnection, Transaction, UserProfile } from "../types/domain";
import { API_ROUTES } from "../types/api";
import { supabase } from "./supabaseClient";
import { getStateTaxContext } from "../utils/stateTaxContext";
import {
  estimateMilesFromGasSpend,
  getAllowedMileageDeduction,
  getAverageGasPriceForState,
  getDemoMarginalRateFromAnnualIncome,
  getEstimatedTaxSavings,
} from "../utils/taxMath";

const DEFAULT_API_BASE = "https://hackmsa-2026-production.up.railway.app";

function resolveApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
  if (!configured) return DEFAULT_API_BASE;

  const normalized = configured.replace(/\/+$/, "");
  if (typeof window === "undefined") return normalized;

  const isRemotePage = window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
  const pointsToLocal = /localhost|127\.0\.0\.1|\.railway\.internal/i.test(normalized);
  const insecureOnHttps = window.location.protocol === "https:" && normalized.startsWith("http://");

  if ((isRemotePage && pointsToLocal) || insecureOnHttps) {
    return DEFAULT_API_BASE;
  }

  return normalized;
}

const API_BASE = resolveApiBaseUrl();
const ALLOW_MOCK_FALLBACK = import.meta.env.VITE_ALLOW_MOCK_FALLBACK !== "false";

async function getAuthHeaders(extraHeaders?: Record<string, string>): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return { ...(extraHeaders ?? {}) };
  }

  return {
    ...(extraHeaders ?? {}),
    Authorization: `Bearer ${token}`,
  };
}

function mapDashboard(data: any): DashboardResponse {
  return {
    metrics: {
      totalIncome: Number(data?.metrics?.totalIncome ?? 0),
      estimatedTaxLiability: Number(data?.metrics?.estimatedTaxLiability ?? 0),
      totalDeductionsFound: Number(data?.metrics?.totalDeductionsFound ?? 0),
    },
    transactions: (data?.transactions ?? []).map((t: any) => ({
      id: String(t.id),
      date: String(t.date ?? ""),
      merchant: String(t.merchant ?? "Unknown"),
      amount: Number(t.amount ?? 0),
      type: t.type,
      category: t.category,
      confidenceScore: Number(t.confidenceScore ?? t.confidence_score ?? 1),
      source: t.source,
      notes: t.notes ?? undefined,
    })),
    deductions: (data?.deductions ?? []).map((d: any) => ({
      id: String(d.id),
      title: String(d.title ?? ""),
      category: String(d.category ?? ""),
      status: d.status,
      potentialSavings: Number(d.potentialSavings ?? d.potential_savings ?? 0),
      detail: String(d.detail ?? ""),
    })),
    optimizationSignals: (data?.optimizationSignals ?? data?.optimization_signals ?? []).map((s: any) => ({
      id: String(s.id),
      type: s.type,
      gasSpend: Number(s.gasSpend ?? s.gas_spend ?? 0),
      detectedPeriodLabel: String(s.detectedPeriodLabel ?? s.detected_period_label ?? ""),
    })),
  };
}

function withLatency<T>(value: T, ms = 700): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

function cloneProfile(profile: UserProfile): UserProfile {
  return { ...profile, gigs: [...profile.gigs] };
}

function sumIncomeFromTransactions(transactions: Transaction[]): number {
  return transactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
}

/** Dashboard metrics scale from profile + static mock transactions (demo). */
function buildDashboardMetrics(profile: UserProfile, transactions: Transaction[]): DashboardMetrics {
  const txnIncome = sumIncomeFromTransactions(transactions);
  const annual = Math.max(0, profile.estimatedAnnualIncome);
  const blendedIncome = Math.round(Math.max(txnIncome, annual));

  const ctx = getStateTaxContext(profile.state);
  const incomeRatio = blendedIncome / Math.max(1, mockMetrics.totalIncome);

  const estimatedTaxLiability = Math.round(
    mockMetrics.estimatedTaxLiability * incomeRatio * ctx.liabilityMultiplier
  );

  const deductionTilt = 0.94 + 0.08 * Math.min(1.2, Math.max(0.8, ctx.liabilityMultiplier));
  const totalDeductionsFound = Math.round(mockMetrics.totalDeductionsFound * deductionTilt);

  return {
    totalIncome: blendedIncome,
    estimatedTaxLiability: Math.max(0, estimatedTaxLiability),
    totalDeductionsFound: Math.max(0, totalDeductionsFound),
  };
}

function initialProfile(): UserProfile {
  const p = cloneProfile(mockUser);
  p.estimatedMarginalTaxRate = getDemoMarginalRateFromAnnualIncome(p.estimatedAnnualIncome);
  return p;
}

let currentMockProfile: UserProfile = initialProfile();

export async function getCurrentUser(): Promise<UserProfile> {
  return withLatency(cloneProfile(currentMockProfile), 450);
}

export async function getDashboardData(): Promise<DashboardResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}${API_ROUTES.dashboard}`, { headers });
    if (response.ok) {
      const data = await response.json();
      return mapDashboard(data);
    }
    throw new Error(`GET ${API_ROUTES.dashboard} failed with status ${response.status}`);
  } catch {
    if (!ALLOW_MOCK_FALLBACK) {
      throw new Error("Unable to load dashboard from backend. Set VITE_ALLOW_MOCK_FALLBACK=true to allow local mock fallback.");
    }
  }

  const gigTransactions = getMockTransactionsForGigs(currentMockProfile.gigs);

  return withLatency(
    {
      metrics: buildDashboardMetrics(currentMockProfile, gigTransactions),
      transactions: gigTransactions,
      deductions: mockDeductions,
      optimizationSignals: getMockOptimizationSignals(gigTransactions),
    },
    850
  );
}

export async function saveOnboarding(payload: OnboardingPayload): Promise<{ profile: UserProfile; integrations: IntegrationConnection[] }> {
  const state = payload.state.trim().toUpperCase().slice(0, 2) || currentMockProfile.state;
  const estimatedAnnualIncome = Math.max(
    0,
    Math.floor(payload.estimatedAnnualIncome || estimateAnnualIncomeFromGigs(payload.gigs))
  );
  const fullName = payload.fullName.trim() || currentMockProfile.fullName;
  const email = payload.email.trim().toLowerCase() || currentMockProfile.email;

  currentMockProfile = {
    ...currentMockProfile,
    fullName,
    email,
    gigs: [...payload.gigs],
    state,
    estimatedAnnualIncome,
    estimatedMarginalTaxRate: getDemoMarginalRateFromAnnualIncome(estimatedAnnualIncome),
    onboardingCompleted: true,
  };

  return withLatency(
    {
      profile: cloneProfile(currentMockProfile),
      integrations: payload.integrations.map((i) => ({ ...i })),
    },
    900
  );
}

export async function scanReceiptFile(fileName: string): Promise<ReceiptScanResponse> {
  const hint = fileName.toLowerCase();
  const suggestedCategory = hint.includes("uber") ? "Travel" : "Supplies";
  return withLatency(
    {
      merchant: "Scanned Merchant",
      amount: 84.75,
      date: new Date().toISOString().slice(0, 10),
      suggestedCategory,
    },
    1400
  );
}

export async function getOptimizationMileage(payload: OptimizationMileagePayload): Promise<OptimizationMileageResult> {
  const averageGasPrice = getAverageGasPriceForState(payload.state, avgGasPriceByState2025);
  const estimatedMiles = estimateMilesFromGasSpend(payload.gasSpend, averageGasPrice, payload.mpg);
  const allowedDeductionAmount = getAllowedMileageDeduction(payload.businessMiles);
  const taxSavingsClaimed = getEstimatedTaxSavings(allowedDeductionAmount);

  return withLatency(
    {
      averageGasPrice,
      estimatedMiles,
      allowedDeductionAmount,
      taxSavingsClaimed,
    },
    500
  );
}

export async function saveFilingPreparation(payload: FilingPreparationPayload): Promise<{ saved: true; profile: FilingPreparationPayload }> {
  return withLatency({ saved: true, profile: payload }, 700);
}

export async function getFilingPreparationDefaults() {
  return withLatency(mockFilingProfile, 400);
}

export async function startFilingRun(payload: FilingRunStartPayload): Promise<FilingRun> {
  return withLatency({ ...mockFilingRun, provider: payload.provider }, 800);
}

export async function approveCurrentFilingStep(run: FilingRun): Promise<FilingRun> {
  const nextIndex = run.currentStepIndex + 1;
  const updatedSteps = run.steps.map((step, index) => {
    if (index === run.currentStepIndex) {
      return { ...step, status: "completed" as const };
    }
    if (index === nextIndex) {
      return { ...step, status: "ready_for_approval" as const };
    }
    return step;
  });

  const complete = nextIndex >= run.steps.length;
  const nextRun: FilingRun = {
    ...run,
    steps: updatedSteps,
    currentStepIndex: complete ? run.steps.length - 1 : nextIndex,
    status: complete ? "completed" : "awaiting_user",
  };

  return withLatency(nextRun, 650);
}

export async function getIntegrationDefaults(): Promise<IntegrationConnection[]> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}${API_ROUTES.integrationDefaults}`, { headers });
    if (response.ok) {
      return (await response.json()) as IntegrationConnection[];
    }
  } catch {
    // Fall back to local mock data when backend is unavailable.
  }

  return withLatency(mockIntegrations, 420);
}

export async function createPlaidLinkToken(): Promise<PlaidLinkTokenResponse> {
  const headers = await getAuthHeaders({
    "Content-Type": "application/json",
  });

  const response = await fetch(`${API_BASE}${API_ROUTES.plaidLinkToken}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ client_user_id: mockUser.id }),
  });

  if (!response.ok) {
    throw new Error("Failed to create Plaid link token.");
  }

  return (await response.json()) as PlaidLinkTokenResponse;
}

export async function exchangePlaidPublicToken(payload: PlaidExchangeRequest): Promise<PlaidExchangeResponse> {
  const headers = await getAuthHeaders({
    "Content-Type": "application/json",
  });

  const response = await fetch(`${API_BASE}${API_ROUTES.plaidExchange}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Failed to exchange Plaid public token.");
  }

  return (await response.json()) as PlaidExchangeResponse;
}

export async function syncAllPlaidTransactions(): Promise<PlaidSyncResponse> {
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_BASE}${API_ROUTES.plaidSyncAll}`, {
    method: "POST",
    headers,
  });

  if (!response.ok) {
    throw new Error("Failed to sync Plaid transactions.");
  }

  return (await response.json()) as PlaidSyncResponse;
}

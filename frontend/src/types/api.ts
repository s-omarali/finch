import type {
  DashboardMetrics,
  Deduction,
  FilingProfile,
  FilingRun,
  IntegrationConnection,
  OptimizationSignal,
  Transaction,
  UserProfile,
} from "./domain";

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface DashboardResponse {
  metrics: DashboardMetrics;
  transactions: Transaction[];
  deductions: Deduction[];
  optimizationSignals: OptimizationSignal[];
}

export interface OnboardingPayload {
  fullName: string;
  email: string;
  gigs: UserProfile["gigs"];
  integrations: IntegrationConnection[];
  /** US state of residence, 2-letter code. */
  state: string;
  /** Whole dollars (≥ 0). */
  estimatedAnnualIncome: number;
}

export interface ReceiptScanResponse {
  merchant: string;
  amount: number;
  date: string;
  suggestedCategory: Transaction["category"];
}

export interface OptimizationMileagePayload {
  state: string;
  mpg: number;
  businessMiles: number;
  gasSpend: number;
}

export interface OptimizationMileageResult {
  averageGasPrice: number;
  estimatedMiles: number;
  allowedDeductionAmount: number;
  taxSavingsClaimed: number;
}

export interface FilingPreparationPayload extends FilingProfile {
  acceptDisclosure: boolean;
}

export interface FilingRunStartPayload {
  provider: FilingRun["provider"];
}

export interface PlaidLinkTokenResponse {
  link_token: string;
  expiration: string;
}

export interface PlaidExchangeRequest {
  public_token: string;
}

export interface PlaidExchangeResponse {
  item_id: string;
  request_id?: string;
}

export interface PlaidSyncResponse {
  synced_item_ids: string[];
  total_added: number;
}

export interface PlaidDisconnectResponse {
  removed_item_ids: string[];
  errors: string[];
}

export const API_ROUTES = {
  me: "/api/v1/me",
  dashboard: "/api/v1/dashboard",
  integrations: "/api/v1/integrations",
  integrationDefaults: "/api/v1/integrations/defaults",
  onboarding: "/api/v1/onboarding",
  plaidLinkToken: "/api/v1/plaid/link-token",
  plaidExchange: "/api/v1/plaid/exchange",
  plaidSyncAll: "/api/v1/plaid/sync-all",
  plaidDisconnect: "/api/v1/plaid/disconnect",
  receiptScan: "/api/v1/receipts/scan",
  optimizationMileage: "/api/v1/optimization/mileage",
  filingPreparation: "/api/v1/filing/preparation",
  filingRun: "/api/v1/filing/runs",
} as const;

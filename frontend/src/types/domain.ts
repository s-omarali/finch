export type GigType = "Content Creator" | "Video Editor" | "Streamer" | "Photographer" | "Podcaster" | "Freelance Writer";

export type TransactionCategory =
  | "Income"
  | "Software"
  | "Travel"
  | "Meals"
  | "Vehicle"
  | "Home Office"
  | "Supplies"
  | "Personal"
  | "Uncategorized";

export interface Transaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  type: "income" | "expense";
  category: TransactionCategory;
  confidenceScore: number;
  source: "bank" | "email" | "receipt";
  notes?: string;
}

export interface Deduction {
  id: string;
  title: string;
  category: string;
  status: "available" | "in_progress" | "claimed";
  potentialSavings: number;
  detail: string;
}

export interface IntegrationConnection {
  id: "bank" | "stripe" | "twitch" | "youtube" | "paypal" | "patreon";
  name: string;
  description: string;
  connected: boolean;
  lastSyncAt?: string;
  comingSoon?: boolean;
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  gigs: GigType[];
  /** US state of residence, 2-letter code (e.g. CA). */
  state: string;
  /** Whole dollars; used with linked transactions for dashboard income / liability demos. */
  estimatedAnnualIncome: number;
  estimatedMarginalTaxRate: number;
  onboardingCompleted: boolean;
}

export interface DashboardMetrics {
  totalIncome: number;
  estimatedTaxLiability: number;
  totalDeductionsFound: number;
}

/** Vehicle mileage — uses live mileage API in OptimizationNudgeCard */
export interface VehicleMileageOptimizationSignal {
  id: string;
  type: "vehicle_mileage";
  /** When true, hidden from Optimization (demo only — no persistence). */
  completed?: boolean;
  /** User intentionally dismissed this optimization. */
  dismissed?: boolean;
  label: string;
  gasSpend: number;
  detectedPeriodLabel: string;
}

/** Home office — simplified area × business-use estimate (demo). */
export interface HomeOfficeOptimizationSignal {
  id: string;
  type: "home_office";
  completed?: boolean;
  dismissed?: boolean;
  label: string;
  workspaceSqFt: number;
  suggestedBusinessUsePercent: number;
  /** Display hint aligned with mock Deduction.potentialSavings */
  potentialSavingsHint: number;
}

export interface MealReviewItem {
  transactionId: string;
  date: string;
  merchant: string;
  amount: number;
  businessPurpose?: string;
  attendees?: string;
}

export interface MealReviewOptimizationSignal {
  id: string;
  type: "meal_review";
  completed?: boolean;
  dismissed?: boolean;
  label: string;
  threshold: number;
  meals: MealReviewItem[];
}

export type OptimizationSignal =
  | VehicleMileageOptimizationSignal
  | HomeOfficeOptimizationSignal
  | MealReviewOptimizationSignal;

export interface FilingProfile {
  legalName: string;
  ssnLast4: string;
  filingStatus: "single" | "married_joint" | "married_separate" | "head_household";
  dependents: number;
  address1: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface FilingRunStep {
  id: string;
  label: string;
  status: "pending" | "ready_for_approval" | "completed";
  preview: Array<{ field: string; value: string }>;
}

export interface FilingRun {
  runId: string;
  status: "idle" | "running" | "awaiting_user" | "completed";
  provider: "TurboTax" | "FreeTaxUSA";
  currentStepIndex: number;
  steps: FilingRunStep[];
}

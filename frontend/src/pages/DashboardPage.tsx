import {
  CircleDollarSign,
  Receipt,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ActionRequiredCard } from "../components/dashboard/ActionRequiredCard";
import { CategorizationFeed } from "../components/dashboard/CategorizationFeed";
import { MetricCard } from "../components/dashboard/MetricCard";
import { EmptyState } from "../components/state/EmptyState";
import { LoadingState } from "../components/state/LoadingState";
import { useOptimizationReview } from "../context/OptimizationReviewContext";
import { getCurrentUser, getDashboardData, getPlaidTestUserData } from "../services/api";
import type { DashboardResponse } from "../types/api";
import type { UserProfile } from "../types/domain";
import {
  countIncompleteOptimizationSignals,
  estimatePendingOptimizationTaxSavingsUpperBound,
  incompleteOptimizationSignals,
  mergeOptimizationCompletion,
} from "../utils/optimizationSignals";
import { getStateTaxContext } from "../utils/stateTaxContext";
import { formatCurrency } from "../utils/taxMath";

export function DashboardPage() {
  const { completedIds, dismissedIds } = useOptimizationReview();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSandboxPreview, setIsSandboxPreview] = useState(false);

  const mergedOptimizationSignals = useMemo(
    () => mergeOptimizationCompletion(dashboard?.optimizationSignals ?? [], completedIds, dismissedIds),
    [dashboard?.optimizationSignals, completedIds, dismissedIds]
  );

  function handleUpdateTransaction(id: string, patch: Partial<import("../types/domain").Transaction>) {
    setDashboard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        transactions: prev.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      };
    });
  }

  function handleRemoveTransaction(id: string) {
    setDashboard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        transactions: prev.transactions.filter((t) => t.id !== id),
      };
    });
  }

  async function handlePreviewSandbox() {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [dash, profile] = await Promise.all([
        getPlaidTestUserData(),
        getCurrentUser(),
      ]);

      setDashboard(dash);
      setUser(profile);
      setIsSandboxPreview(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load Plaid preview.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;

    async function load() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [dash, profile] = await Promise.all([getDashboardData(), getCurrentUser()]);
        if (!alive) return;
        setDashboard(dash);
        setUser(profile);
      } catch (error) {
        if (!alive) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load dashboard data.");
      }
      if (!alive) return;
      setIsLoading(false);
    }

    void load();
    return () => { alive = false; };
  }, []);

  /** Aligns with incomplete rows in `optimizationSignals` (each card on /optimization), including user-completed reviews. */
  const optimizationPendingCount = useMemo(
    () => countIncompleteOptimizationSignals(mergedOptimizationSignals),
    [mergedOptimizationSignals]
  );

  const optimizationPendingSavingsUpperBound = useMemo(
    () =>
      estimatePendingOptimizationTaxSavingsUpperBound(
        incompleteOptimizationSignals(mergedOptimizationSignals),
        user?.estimatedMarginalTaxRate ?? 0.24,
        user?.state ?? "TX"
      ),
    [mergedOptimizationSignals, user?.estimatedMarginalTaxRate, user?.state]
  );

  const linkedIncomeTotal = useMemo(
    () =>
      dashboard?.transactions
        .filter((t) => t.type === "income")
        .reduce((sum, t) => sum + t.amount, 0) ?? 0,
    [dashboard?.transactions]
  );

  const stateTaxContext = useMemo(
    () => getStateTaxContext(user?.state ?? "TX"),
    [user?.state]
  );

if (isLoading) {
    return <LoadingState title="Dashboard" description="Running the numbers…" />;
  }

  const firstName = user?.fullName?.split(" ")[0] ?? "Creator";
  const bracketPct = user?.estimatedMarginalTaxRate
    ? `${(user.estimatedMarginalTaxRate * 100).toFixed(0)}%`
    : "";

  if (loadError) {
    return <EmptyState title="Dashboard data unavailable" description={loadError} />;
  }

  if (!dashboard || dashboard.transactions.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="Connect an account or upload a receipt — we'll fill this right up."
      />
    );
  }
  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold tracking-[0.12em] uppercase mb-1" style={{ color: "rgba(0,255,133,0.75)" }}>
            {isSandboxPreview ? "Plaid sandbox preview" : "Tax overview"}
          </p>
          <h1 className="text-[1.75rem] font-extrabold text-[#EDEDED] leading-tight">
            Hey {firstName} — here&apos;s where you stand.
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: "#a3a3a3" }}>
            2026 · {user?.state ?? "—"} — {stateTaxContext.note}
          </p>
          {bracketPct ? (
            <>
              <p className="text-[13px] mt-2 text-[#EDEDED]">Marginal rate (demo bracket): {bracketPct}</p>
              <p className="text-[12px] mt-1 leading-snug" style={{ color: "#666666" }}>
                From your income band — we&apos;ll help you offset with write-offs you qualify for.
              </p>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 self-start">
        <a
          href="/filing-prep"
          className="hidden md:inline-flex flex-shrink-0 items-center justify-center gap-2 self-start rounded-xl px-4 py-2.5 text-[13px] font-extrabold transition-all duration-150 whitespace-nowrap"
          style={{
            background: "rgba(59,130,246,0.14)",
            border: "1px solid rgba(59,130,246,0.35)",
            color: "#3B82F6",
            boxShadow: "0 0 22px rgba(59,130,246,0.12)",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(59,130,246,0.22)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(59,130,246,0.14)"; }}
        >
          Filing prep →
        </a>

        <a
          href="/filing-prep"
          className="hidden md:inline-flex flex-shrink-0 items-center justify-center gap-2 self-start rounded-xl px-4 py-2.5 text-[13px] font-extrabold transition-all duration-150 whitespace-nowrap"
          style={{
            background: "rgba(59,130,246,0.14)",
            border: "1px solid rgba(59,130,246,0.35)",
            color: "#3B82F6",
            boxShadow: "0 0 22px rgba(59,130,246,0.12)",
          }}
        >
          Filing prep →
        </a>

        <button
          type="button"
          onClick={() => void handlePreviewSandbox()}
          className="hidden md:inline-flex flex-shrink-0 items-center justify-center gap-2 self-start rounded-xl px-4 py-2.5 text-[13px] font-extrabold transition-all duration-150 whitespace-nowrap"
          style={{
            background: isSandboxPreview ? "rgba(0,255,133,0.14)" : "rgba(255,255,255,0.05)",
            border: isSandboxPreview ? "1px solid rgba(0,255,133,0.28)" : "1px solid rgba(255,255,255,0.08)",
            color: isSandboxPreview ? "#00FF85" : "#EDEDED",
          }}
        >
          Preview Plaid sandbox
        </button>
      </div>
      </div>

      {/* ── HERO — Money we saved you ───────────────────────────────── */}
      <MetricCard
        label="Money we saved you"
        value={formatCurrency(dashboard.metrics.totalDeductionsFound)}
        subtext={`${dashboard.deductions.filter((d) => d.status === "claimed").length} confirmed · ${optimizationPendingCount} still pending your review on Optimization`}
        icon={<TrendingUp className="h-6 w-6" />}
        accent="green"
        hero
      />

      {/* ── Metric row ─────────────────────────────────────────────── */}
      <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-2">
        <MetricCard
          label="Estimated annual income"
          value={formatCurrency(dashboard.metrics.totalIncome)}
          subtext={`Based on linked payout activity (${formatCurrency(linkedIncomeTotal)}) and gig-based annual run-rate modeling`}
          icon={<CircleDollarSign className="h-4 w-4" />}
          accent="blue"
        />
        <MetricCard
          label="Estimated tax due"
          value={formatCurrency(dashboard.metrics.estimatedTaxLiability)}
          subtext={`Demo model scales by ${user?.state ?? "—"} (×${stateTaxContext.liabilityMultiplier.toFixed(2)}) — not tax advice`}
          icon={<ShieldCheck className="h-4 w-4" />}
          accent="amber"
        />
      </section>

      {/* ── Bento grid: AI Feed + right-rail ───────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <CategorizationFeed
          transactions={dashboard.transactions}
          onUpdateTransaction={handleUpdateTransaction}
          onRemoveTransaction={handleRemoveTransaction}
        />

        <div className="space-y-6">
          {optimizationPendingCount > 0 && (
            <ActionRequiredCard
              pendingCount={optimizationPendingCount}
              maxPotentialTaxSavings={optimizationPendingSavingsUpperBound}
            />
          )}

          <div className="bento-card" style={{ padding: "20px" }}>
            <div className="flex items-center gap-2 mb-4">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ background: "rgba(168,85,247,0.12)", color: "#C084FC" }}
              >
                <Receipt className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-[13px] font-extrabold text-[#EDEDED]">Deductions found</h2>
                <p className="text-[11px] mt-0.5 leading-snug" style={{ color: "#666666" }}>
                  Savings we flagged for your return.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {dashboard.deductions.map((ded) => {
                const claimed = ded.status === "claimed";
                return (
                  <div
                    key={ded.id}
                    className="relative flex items-center justify-between rounded-xl px-3 py-2.5 overflow-visible"
                    style={{
                      background: "rgba(255,255,255,0.025)",
                      border: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    {claimed && (
                      <span
                        className="pointer-events-none absolute -top-2 right-3 mn text-[11px] font-extrabold px-2 py-0.5 rounded-md"
                        style={{
                          color: "#050505",
                          background: "#00FF85",
                          boxShadow: "0 0 18px rgba(0,255,133,0.35)",
                        }}
                      >
                        +{formatCurrency(ded.potentialSavings)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-[#EDEDED] truncate">{ded.title}</p>
                      <p className="text-[11px] text-[#666666]">{ded.detail}</p>
                    </div>
                    <div className="flex flex-col items-end flex-shrink-0 ml-3">
                      {!claimed && (
                        <p className="mn text-[13px] font-bold" style={{ color: "#00FF85" }}>
                          +{formatCurrency(ded.potentialSavings)}
                        </p>
                      )}
                      <span
                        className={`chip ${claimed ? "mt-0" : "mt-0.5"}`}
                        style={
                          ded.status === "claimed"
                            ? { background: "rgba(0,255,133,0.1)", color: "#00FF85" }
                            : ded.status === "in_progress"
                            ? { background: "rgba(59,130,246,0.1)", color: "#3B82F6" }
                            : { background: "rgba(255,255,255,0.06)", color: "#888888" }
                        }
                      >
                        {ded.status === "claimed" ? "Claimed" : ded.status === "in_progress" ? "In progress" : "Available"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

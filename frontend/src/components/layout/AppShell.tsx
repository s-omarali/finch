import {
  BarChart3,
  ClipboardList,
  FileSpreadsheet,
  LogOut,
  ReceiptText,
  Settings,
} from "lucide-react";
import { GigaTaxWordmark } from "../branding/GigaTaxWordmark";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useOptimizationReview } from "../../context/OptimizationReviewContext";
import { getCurrentUser, getDashboardData } from "../../services/api";
import { auth } from "../../services/supabaseClient";
import type { UserProfile } from "../../types/domain";
import {
  countIncompleteOptimizationSignals,
  mergeOptimizationCompletion,
} from "../../utils/optimizationSignals";

const navItems = [
  { to: "/dashboard",    label: "Dashboard",       icon: BarChart3,    activeEmoji: "📊" },
  { to: "/receipts",     label: "Receipt Capture", icon: ReceiptText,  activeEmoji: "🧾" },
  { to: "/optimization", label: "Optimization",    icon: ClipboardList, activeEmoji: "⚡" },
  { to: "/filing-prep",  label: "Review and File", icon: FileSpreadsheet, activeEmoji: "✅" },
  { to: "/settings",     label: "Settings",        icon: Settings,     activeEmoji: "⚙️" },
];

export function AppShell() {
  const { completedIds, dismissedIds } = useOptimizationReview();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [dashForBadge, setDashForBadge] = useState<Awaited<ReturnType<typeof getDashboardData>> | null>(null);

  const optimizationBadgeCount = useMemo(() => {
    if (!dashForBadge) return 0;
    const merged = mergeOptimizationCompletion(dashForBadge.optimizationSignals, completedIds, dismissedIds);
    return countIncompleteOptimizationSignals(merged);
  }, [dashForBadge, completedIds, dismissedIds]);

  useEffect(() => {
    let alive = true;
    async function load() {
      const [profile, dash] = await Promise.all([getCurrentUser(), getDashboardData()]);
      if (!alive) return;
      setUser(profile);
      setDashForBadge(dash);
    }
    void load();
    return () => { alive = false; };
  }, []);

  const navigate = useNavigate();

  const firstName = useMemo(() => {
    if (!user?.fullName) return null;
    return user.fullName.split(" ")[0];
  }, [user?.fullName]);

  async function handleSignOut() {
    await auth.signOut();
    navigate("/start");
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: "#0a0a0f" }}
    >
      {/* Ambient radial blobs — placed behind everything */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-32 left-1/3 w-[700px] h-[550px] rounded-full blur-[160px]"
          style={{ background: "rgba(0,255,133,0.05)" }}
        />
        <div
          className="absolute bottom-0 right-0 w-[600px] h-[500px] rounded-full blur-[160px]"
          style={{ background: "rgba(59,130,246,0.06)" }}
        />
      </div>

      <div className="relative mx-auto grid w-full max-w-[1440px] gap-6 px-6 py-6 md:grid-cols-[220px_1fr]">
        {/* ── Sidebar ── */}
        <aside className="sticky top-6 h-fit">
          <div
            className="bento-card p-0 overflow-hidden"
            style={{ padding: 0 }}
          >
            {/* Brand */}
            <div className="px-5 py-5 border-b border-white/[0.06]">
              <div className="min-w-0">
                <GigaTaxWordmark size="xl" className="block" />
                <p className="text-[13px] font-semibold text-[#EDEDED] leading-tight">
                  Your tax workspace
                </p>
              </div>
            </div>

            {/* Nav — Optimization row shows a red badge when incomplete optimization reviews remain (clears as you confirm each on the Optimization tab; session-only — full reload resets for demo). */}
            <nav className="px-3 py-3 space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const showOptBadge = item.to === "/optimization" && optimizationBadgeCount > 0;
                const badgeLabel =
                  optimizationBadgeCount > 9 ? "9+" : String(optimizationBadgeCount);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    aria-label={
                      showOptBadge
                        ? `Optimization, ${optimizationBadgeCount} item${optimizationBadgeCount !== 1 ? "s" : ""} need review`
                        : undefined
                    }
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-150 ${
                        isActive
                          ? "text-[#EDEDED]"
                          : "text-[#888888] hover:text-[#EDEDED] hover:bg-white/[0.04]"
                      }`
                    }
                    style={({ isActive }) =>
                      isActive
                        ? {
                            background: "rgba(59,130,246,0.12)",
                            border: "1px solid rgba(59,130,246,0.25)",
                          }
                        : { border: "1px solid transparent" }
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        <span className="relative flex-1 min-w-0 pr-3">
                          <span className="block truncate">
                            {isActive ? `${item.activeEmoji} ${item.label}` : item.label}
                          </span>
                          {showOptBadge && (
                            optimizationBadgeCount === 1 ? (
                              <span
                                className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
                                style={{
                                  background: "#EF4444",
                                  boxShadow: "0 0 0 2px #0a0a0f",
                                }}
                                aria-hidden
                              />
                            ) : (
                              <span
                                className="absolute right-0 top-1/2 flex h-[18px] min-w-[18px] -translate-y-1/2 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
                                style={{
                                  background: "#EF4444",
                                  boxShadow: "0 0 0 2px #0a0a0f",
                                }}
                                aria-hidden
                              >
                                {badgeLabel}
                              </span>
                            )
                          )}
                        </span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </nav>

            {/* Footer hint */}
            <div className="px-5 py-4 border-t border-white/[0.05] flex items-center justify-between">
              <p className="text-[11px] text-[#555555] leading-relaxed">
                Tax year <span className="text-[#888888] font-medium">2026</span>
                {firstName ? (
                  <> · <span className="text-[#888888]">{firstName}</span></>
                ) : null}
              </p>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="flex items-center gap-1 text-[11px] text-[#555555] hover:text-[#EF4444] transition-colors"
              >
                <LogOut className="h-3 w-3" />
                Sign out
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="min-w-0 space-y-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

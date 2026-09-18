import { BarChart3, Link2, Music, Radio, ShieldCheck, Sparkles, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../components/state/EmptyState";
import { LoadingState } from "../components/state/LoadingState";
import { usePlaidConnect } from "../hooks/usePlaidConnect";
import { disconnectPlaid, getIntegrations } from "../services/api";
import type { IntegrationConnection } from "../types/domain";

const PLATFORM_ICONS: Record<IntegrationConnection["id"], typeof Link2> = {
  bank: ShieldCheck,
  stripe: BarChart3,
  twitch: Radio,
  youtube: Video,
  paypal: Sparkles,
  patreon: Music,
};

export function SettingsPage() {
  const [integrations, setIntegrations] = useState<IntegrationConnection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadIntegrations = useCallback(async () => {
    try {
      const data = await getIntegrations();
      setIntegrations(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load connections");
    }
  }, []);

  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  const { startConnect, isConnecting } = usePlaidConnect(loadIntegrations);

  async function handleDisconnectBank() {
    if (!window.confirm("Disconnect this bank account? You'll need to reconnect via Plaid to resume syncing.")) {
      return;
    }
    setIsDisconnecting(true);
    setActionError(null);
    try {
      const result = await disconnectPlaid();
      if (result.errors.length > 0 && result.removed_item_ids.length === 0) {
        setActionError(`Disconnect failed: ${result.errors.join("; ")}`);
      } else if (result.errors.length > 0) {
        setActionError(`Disconnected, but some items failed to remove: ${result.errors.join("; ")}`);
      }
      await loadIntegrations();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setIsDisconnecting(false);
    }
  }

  if (loadError) {
    return <EmptyState title="Connections unavailable" description={loadError} />;
  }

  if (!integrations) {
    return <LoadingState title="Loading connections" description="Fetching your account connections…" />;
  }

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div>
        <p
          className="text-[11px] font-extrabold tracking-[0.12em] uppercase mb-1"
          style={{ color: "rgba(0,255,133,0.75)" }}
        >
          Settings
        </p>
        <h1 className="text-[1.75rem] font-extrabold text-[#EDEDED] leading-tight">
          Connected accounts
        </h1>
        <p className="text-[13px] mt-1.5" style={{ color: "#a3a3a3" }}>
          Manage where GigATax pulls your income and transactions from.
        </p>
      </div>

      {actionError && (
        <div
          className="rounded-xl px-4 py-3 text-[13px]"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#EF4444" }}
        >
          {actionError}
        </div>
      )}

      {/* ── Connections list ──────────────────────────────────────── */}
      <div className="bento-card space-y-2.5">
        {integrations.map((integration) => {
          const connected = integration.connected;
          const comingSoon = Boolean(integration.comingSoon);
          const PlatformIcon = PLATFORM_ICONS[integration.id] ?? Link2;

          return (
            <div
              key={integration.id}
              className="relative flex items-center justify-between rounded-2xl px-5 py-4 transition-all duration-150"
              style={{
                background: connected ? "rgba(0,255,133,0.04)" : "rgba(255,255,255,0.03)",
                border: connected ? "1px solid rgba(0,255,133,0.2)" : "1px solid rgba(255,255,255,0.08)",
                opacity: comingSoon ? 0.6 : 1,
              }}
            >
              <div className="flex items-center gap-4 min-w-0">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0"
                  style={{ background: connected ? "rgba(0,255,133,0.1)" : "rgba(255,255,255,0.05)" }}
                >
                  <PlatformIcon className="h-5 w-5" style={{ color: connected ? "#00FF85" : "#555555" }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-semibold text-[#EDEDED] truncate">{integration.name}</p>
                    {comingSoon && (
                      <span
                        className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                        style={{ background: "rgba(255,255,255,0.06)", color: "#888888" }}
                      >
                        Coming soon
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] truncate" style={{ color: "#555555" }}>
                    {connected && integration.lastSyncAt
                      ? `Synced ${new Date(integration.lastSyncAt).toLocaleDateString()}`
                      : integration.description}
                  </p>
                </div>
              </div>

              <div className="flex-shrink-0">
                {comingSoon ? (
                  <span
                    className="flex items-center gap-2 rounded-xl px-4 py-2 text-[12px] font-semibold"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#555555" }}
                  >
                    Unavailable
                  </span>
                ) : connected ? (
                  <button
                    type="button"
                    onClick={() => void handleDisconnectBank()}
                    disabled={isDisconnecting}
                    className="flex items-center gap-2 rounded-xl px-4 py-2 text-[12px] font-semibold transition-all duration-150 active:scale-[0.96] disabled:opacity-50"
                    style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#EF4444" }}
                  >
                    {isDisconnecting ? "Disconnecting…" : "Disconnect"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startConnect()}
                    disabled={isConnecting}
                    className="flex items-center gap-2 rounded-xl px-4 py-2 text-[12px] font-semibold transition-all duration-150 active:scale-[0.96] disabled:opacity-50"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#EDEDED" }}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    {isConnecting ? "Connecting…" : "Connect"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

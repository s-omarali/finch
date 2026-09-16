import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Link2,
  Loader2,
  Mail,
  Music,
  Pencil,
  Radio,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  Video,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GigaTaxWordmark } from "../components/branding/GigaTaxWordmark";
import { estimateAnnualIncomeFromGigs, gigOptions, mockIntegrations } from "../data/mockData";
import { usePlaidConnect } from "../hooks/usePlaidConnect";
import { getIntegrations, saveOnboarding } from "../services/api";
import { auth, supabase } from "../services/supabaseClient";
import type { IntegrationConnection, UserProfile } from "../types/domain";

// ── Icon map ──────────────────────────────────────────────────────────────
const GIG_ICONS: Record<string, React.ReactNode> = {
  "Content Creator":  <Video className="h-4 w-4" />,
  "Video Editor":     <Sparkles className="h-4 w-4" />,
  "Streamer":         <Radio className="h-4 w-4" />,
  "Photographer":     <Pencil className="h-4 w-4" />,
  "Podcaster":        <Music className="h-4 w-4" />,
  "Freelance Writer": <Pencil className="h-4 w-4" />,
};

const TOTAL_ONBOARDING_STEPS = 7;

// ── Seven steps: sign-in → profile → gigs → location → connect → 1099s → done ─────
const STEPS = [
  { number: 1, label: "Sign in" },
  { number: 2, label: "Profile" },
  { number: 3, label: "Your Work" },
  { number: 4, label: "Location" },
  { number: 5, label: "Connect" },
  { number: 6, label: "1099s" },
  { number: 7, label: "You're in" },
];

function isValidEmailFormat(value: string): boolean {
  const t = value.trim();
  if (!t.includes("@")) return false;
  const [local, domain] = t.split("@");
  return Boolean(local && domain && domain.includes("."));
}

/** Payout / platform integrations only — exclude bank from “already covered” messaging. */
const PAYOUT_SUBHEADING_EXCLUDE_IDS: IntegrationConnection["id"][] = ["bank"];

/** Oxford comma: "A", "A and B", "A, B, and C" */
function formatOxfordCommaList(names: string[]): string {
  const n = names.filter(Boolean);
  if (n.length === 0) return "";
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  return `${n.slice(0, -1).join(", ")}, and ${n[n.length - 1]}`;
}

type Integration1099Subheading =
  | { kind: "payouts"; line1: string; line2: string }
  | { kind: "bankOnly"; text: string }
  | { kind: "none"; text: string };

function get1099StepIntegrationSubheading(integrations: IntegrationConnection[]): Integration1099Subheading {
  const connected = integrations.filter((i) => i.connected);
  const payoutNames = connected
    .filter((i) => !PAYOUT_SUBHEADING_EXCLUDE_IDS.includes(i.id))
    .map((i) => i.name);

  if (payoutNames.length > 0) {
    const list = formatOxfordCommaList(payoutNames);
    return {
      kind: "payouts",
      line1: `You're connected to: ${list}.`,
      line2:
        "Upload tax forms for income that isn't already covered by those connections — especially 1099-Ks from other platforms, or 1099-NEC / 1099-MISC from other payers.",
    };
  }

  if (connected.length === 0) {
    return {
      kind: "none",
      text:
        "Connect payout platforms on the previous step to import more automatically, or upload any 1099s you have here — 1099-K, 1099-NEC, and 1099-MISC.",
    };
  }

  const onlyBankConnected = connected.every((i) => i.id === "bank");

  if (onlyBankConnected) {
    return {
      kind: "bankOnly",
      text:
        "Your bank is linked for cash-flow visibility — we don't pull platform 1099-K data from that alone. Upload forms from payers and payout apps you haven't connected yet, or go back and link more sources.",
    };
  }

  return {
    kind: "none",
    text:
      "Upload 1099s from payers we don't pull automatically — especially 1099-Ks where platforms pay you outside your linked sources, or 1099-NEC / 1099-MISC from clients.",
  };
}

// ── 1099 file record ──────────────────────────────────────────────────────
interface Form1099 {
  id: string;
  name: string;
  size: number;
  /** "pending" while fake-uploading, "done" once complete */
  status: "pending" | "done";
  /** Mocked parse result */
  payer?: string;
  income?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Fake parsers for demo realism
const MOCK_PAYERS = ["YouTube LLC", "Patreon Inc.", "Twitch Interactive", "Substack", "Spotify AB", "TikTok Ltd."];
function mockParse(filename: string): { payer: string; income: number } {
  const seed = filename.charCodeAt(0) % MOCK_PAYERS.length;
  return {
    payer: MOCK_PAYERS[seed],
    income: Math.round((seed + 1) * 3271.5 + filename.length * 47.3),
  };
}

function cloneMockIntegrations(): IntegrationConnection[] {
  return mockIntegrations.map((integration) => ({ ...integration }));
}

function mergeIntegrationDefaults(defaults: IntegrationConnection[]): IntegrationConnection[] {
  const byId = new Map(defaults.map((integration) => [integration.id, integration]));
  return cloneMockIntegrations().map((base) => {
    const remote = byId.get(base.id);
    return remote ? { ...base, ...remote, id: base.id } : base;
  });
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1 — sign in (demo: no real OAuth)
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Step 2 — confirm name & email for tax profile
  const [profileFullName, setProfileFullName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileNameError, setProfileNameError] = useState("");
  const [profileEmailError, setProfileEmailError] = useState("");

  // Step 3 — gigs
  const [jobSearch, setJobSearch] = useState("");
  const [selectedGigs, setSelectedGigs] = useState<UserProfile["gigs"]>([]);

  // Step 4 — state
  const [residenceState, setResidenceState] = useState("TX");

  useEffect(() => {
    if (step === 4) setResidenceState("TX");
  }, [step]);

  // Step 5 — connect
  const [integrations, setIntegrations] = useState<IntegrationConnection[]>(() => cloneMockIntegrations());
  const [integrationsExpanded, setIntegrationsExpanded] = useState(false);
  const INTEGRATIONS_PREVIEW = 3;
  /** Bumps when user links an integration — drives short falling-money burst (CSS). */
  const [connectMoneyBurst, setConnectMoneyBurst] = useState<
    Partial<Record<IntegrationConnection["id"], number>>
  >({});
  /** Latest integrations for click handlers — avoids Strict Mode double-updater clearing `willLink`. */
  const integrationsRef = useRef<IntegrationConnection[]>(integrations);
  integrationsRef.current = integrations;

  // Step 6 — 1099 uploads
  const [forms, setForms] = useState<Form1099[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 7 — confirmation
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const defaults = await getIntegrations();
        if (!active) return;
        setIntegrations(mergeIntegrationDefaults(defaults));
      } catch {
        if (!active) return;
        setIntegrations(cloneMockIntegrations());
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const filteredGigs = useMemo(
    () => gigOptions.filter((g) => g.toLowerCase().includes(jobSearch.toLowerCase())),
    [jobSearch]
  );

  const integration1099Subheading = useMemo(
    () => get1099StepIntegrationSubheading(integrations),
    [integrations]
  );

  function toggleGig(gig: UserProfile["gigs"][number]) {
    setSelectedGigs((prev) =>
      prev.includes(gig) ? prev.filter((g) => g !== gig) : [...prev, gig]
    );
  }

  function toggleIntegration(id: IntegrationConnection["id"]) {
    const row = integrationsRef.current.find((i) => i.id === id);
    const willLink = Boolean(row && !row.connected);
    setIntegrations((prev) =>
      prev.map((i) => (i.id === id ? { ...i, connected: !i.connected } : i))
    );
    if (willLink) {
      const token = Date.now();
      setConnectMoneyBurst((m) => ({ ...m, [id]: token }));
      window.setTimeout(() => {
        setConnectMoneyBurst((m) => {
          if (m[id] !== token) return m;
          const { [id]: _, ...rest } = m;
          return rest;
        });
      }, 780);
    }
  }

  const onPlaidConnected = useCallback(() => {
    setIntegrations((prev) =>
      prev.map((integration) =>
        integration.id === "bank"
          ? { ...integration, connected: true, lastSyncAt: new Date().toISOString() }
          : integration
      )
    );
  }, []);

  const { startConnect: startPlaidConnect } = usePlaidConnect(onPlaidConnected);

  async function handleIntegrationConnect(integration: IntegrationConnection) {
    if (integration.id !== "bank") {
      toggleIntegration(integration.id);
      return;
    }

    if (integration.connected) {
      toggleIntegration(integration.id);
      return;
    }

    await startPlaidConnect();
  }

  // ── 1099 upload logic ─────────────────────────────────────────────────
  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const incoming: Form1099[] = Array.from(fileList).map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      name: f.name,
      size: f.size,
      status: "pending" as const,
    }));
    setForms((prev) => [...prev, ...incoming]);

    // Simulate OCR parsing with a short delay per file
    incoming.forEach((form, i) => {
      setTimeout(() => {
        const parsed = mockParse(form.name);
        setForms((prev) =>
          prev.map((f) =>
            f.id === form.id
              ? { ...f, status: "done", payer: parsed.payer, income: parsed.income }
              : f
          )
        );
      }, 900 + i * 400);
    });
  }, []);

  function removeForm(id: string) {
    setForms((prev) => prev.filter((f) => f.id !== id));
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") !== "google") return;
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      setProfileEmail(data.user.email ?? "");
      setProfileFullName(data.user.user_metadata?.full_name ?? "");
      setStep(2);
    });
  }, []);

  async function handleGoogleSignIn() {
    setSignInError("");
    setIsGoogleLoading(true);
    const { error } = await auth.signInWithGoogle();
    if (error) {
      setSignInError(error.message);
      setIsGoogleLoading(false);
    }
    // On success the browser redirects — no need to reset loading state
  }

  async function handleEmailSignInContinue() {
    setSignInError("");
    if (!isValidEmailFormat(signInEmail)) {
      setSignInError("Enter a valid email address.");
      return;
    }
    if (signInPassword.trim().length < 6) {
      setSignInError("Password must be at least 6 characters.");
      return;
    }

    const email = signInEmail.trim().toLowerCase();
    const password = signInPassword.trim();

    // Try sign in first, fall back to sign up
    let result: Awaited<ReturnType<typeof auth.signIn>> | Awaited<ReturnType<typeof auth.signUp>> =
      await auth.signIn(email, password);
    if (result.error) {
      result = await auth.signUp(email, password, "");
    }
    if (result.error) {
      setSignInError(result.error.message);
      return;
    }

    setProfileEmail(email);
    setProfileFullName(result.data?.user?.user_metadata?.full_name ?? "");
    setStep(2);
  }

  function validateProfileStep(): boolean {
    let ok = true;
    const name = profileFullName.trim();
    if (!name) {
      setProfileNameError("Enter your full legal name.");
      ok = false;
    } else {
      setProfileNameError("");
    }
    if (!isValidEmailFormat(profileEmail)) {
      setProfileEmailError("Enter a valid email address.");
      ok = false;
    } else {
      setProfileEmailError("");
    }
    return ok;
  }

  async function handleFinish() {
    const derivedAnnualIncome = estimateAnnualIncomeFromGigs(selectedGigs);
    setIsSaving(true);
    setSaveError("");
    try {
      await saveOnboarding({
        fullName: profileFullName.trim(),
        email: profileEmail.trim().toLowerCase(),
        gigs: selectedGigs,
        integrations,
        state: residenceState,
        estimatedAnnualIncome: derivedAnnualIncome,
      });
      setStep(7);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "We couldn't finish onboarding right now. Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  }

  const totalDetectedIncome = forms
    .filter((f) => f.status === "done" && f.income)
    .reduce((sum, f) => sum + (f.income ?? 0), 0);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#0a0a0f", color: "#EDEDED" }}
    >
      {/* ── Ambient blobs ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full blur-[180px]"
          style={{ background: "rgba(0,255,133,0.06)" }}
        />
        <div
          className="absolute bottom-0 right-0 w-[600px] h-[500px] rounded-full blur-[160px]"
          style={{ background: "rgba(59,130,246,0.07)" }}
        />
      </div>

      {/* ── Top bar ── */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5">
        <div className="flex items-center">
          <GigaTaxWordmark size="xl" />
        </div>

        {/* Step progress — 7 pills */}
        <div className="flex items-center gap-1.5">
          {STEPS.map((s) => {
            const complete = step > s.number || step === TOTAL_ONBOARDING_STEPS;
            const current = step === s.number && step < TOTAL_ONBOARDING_STEPS;
            return (
              <div
                key={s.number}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: current ? "28px" : step === TOTAL_ONBOARDING_STEPS ? "22px" : "10px",
                  background: complete
                    ? "#00FF85"
                    : current
                    ? "#3B82F6"
                    : "rgba(255,255,255,0.1)",
                }}
              />
            );
          })}
          {step < TOTAL_ONBOARDING_STEPS && (
            <span className="ml-2 text-[11px] font-medium" style={{ color: "#555555" }}>
              {step} / {TOTAL_ONBOARDING_STEPS}
            </span>
          )}
          {step === TOTAL_ONBOARDING_STEPS && (
            <span className="ml-2 text-[11px] font-medium" style={{ color: "#00FF85" }}>
              {TOTAL_ONBOARDING_STEPS} / {TOTAL_ONBOARDING_STEPS} ✓
            </span>
          )}
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-[560px]">

          {/* ══════════════════ STEP 1 — Sign in ══════════════════ */}
          {step === 1 && (
            <div className="animate-rise space-y-7">
              <div
                className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-2xl px-5 py-3"
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {[
                  { icon: "🔒", text: "256-bit encryption" },
                  { icon: "✓", text: "we don't sell your data" },
                  { icon: "★", text: "built for creators, not accountants" },
                ].map(({ icon, text }) => (
                  <div key={text} className="flex items-center gap-1.5">
                    <span className="text-[11px]" style={{ color: "#00FF85" }}>{icon}</span>
                    <span className="text-[11px] font-medium" style={{ color: "#888888" }}>{text}</span>
                  </div>
                ))}
              </div>

              <div className="text-center">
                <p className="text-[11px] font-semibold tracking-[0.14em] uppercase mb-3" style={{ color: "rgba(0,255,133,0.7)" }}>
                  Step 1 of {TOTAL_ONBOARDING_STEPS}
                </p>
                <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-[#EDEDED] mb-3 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
                  <span className="font-bold">Sign in to</span>
                  <GigaTaxWordmark size="2xl" className="translate-y-[0.06em]" />
                </h1>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading}
                className="w-full flex items-center justify-center gap-3 rounded-2xl py-3.5 text-[14px] font-semibold transition-all duration-150 disabled:opacity-50 active:scale-[0.98]"
                style={{
                  background: "#EDEDED",
                  color: "#0a0a0f",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {isGoogleLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <svg className="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden>
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                  </>
                )}
              </button>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.08)" }} />
                <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "#555555" }}>or</span>
                <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.08)" }} />
              </div>

              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium" style={{ color: "#888888" }}>Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={signInEmail}
                    onChange={(e) => {
                      setSignInEmail(e.target.value);
                      if (signInError) setSignInError("");
                    }}
                    placeholder="you@example.com"
                    className="giga-input w-full"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium" style={{ color: "#888888" }}>Password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={signInPassword}
                    onChange={(e) => {
                      setSignInPassword(e.target.value);
                      if (signInError) setSignInError("");
                    }}
                    placeholder="••••••••"
                    className="giga-input w-full"
                  />
                </label>
                {signInError ? (
                  <p className="text-[12px] text-center" style={{ color: "#F87171" }}>{signInError}</p>
                ) : null}
                <button
                  type="button"
                  onClick={handleEmailSignInContinue}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-semibold transition-all duration-150 active:scale-[0.98]"
                  style={{ background: "#3B82F6", color: "#ffffff" }}
                >
                  <Mail className="h-4 w-4" />
                  Continue with email
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════ STEP 2 — Confirm profile ══════════════════ */}
          {step === 2 && (
            <div className="animate-rise space-y-7">
              <div className="text-center">
                <p className="text-[11px] font-semibold tracking-[0.14em] uppercase mb-3" style={{ color: "rgba(59,130,246,0.85)" }}>
                  Step 2 of {TOTAL_ONBOARDING_STEPS}
                </p>
                <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-[#EDEDED] mb-3">
                  Confirm your details
                </h1>
              </div>

              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium" style={{ color: "#888888" }}>Full legal name</span>
                  <input
                    value={profileFullName}
                    onChange={(e) => {
                      setProfileFullName(e.target.value);
                      if (profileNameError) setProfileNameError("");
                    }}
                    placeholder="Jordan Lee"
                    className="giga-input w-full"
                    autoFocus
                  />
                  {profileNameError ? (
                    <p className="text-[12px]" style={{ color: "#F87171" }}>{profileNameError}</p>
                  ) : null}
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium" style={{ color: "#888888" }}>Email</span>
                  <input
                    type="email"
                    value={profileEmail}
                    onChange={(e) => {
                      setProfileEmail(e.target.value);
                      if (profileEmailError) setProfileEmailError("");
                    }}
                    placeholder="you@example.com"
                    className="giga-input w-full"
                  />
                  {profileEmailError ? (
                    <p className="text-[12px]" style={{ color: "#F87171" }}>{profileEmailError}</p>
                  ) : null}
                </label>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 rounded-2xl py-3.5 text-[13px] font-semibold transition-all duration-150"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#888888" }}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (validateProfileStep()) setStep(3);
                  }}
                  className="flex-[2] flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-semibold transition-all duration-150 active:scale-[0.98]"
                  style={{ background: "#3B82F6", color: "#ffffff" }}
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════ STEP 3 — Gig type ══════════════════ */}
          {step === 3 && (
            <div className="animate-rise space-y-7">

              <div className="text-center">
                <p className="text-[11px] font-semibold tracking-[0.14em] uppercase mb-3" style={{ color: "rgba(0,255,133,0.7)" }}>
                  Step 3 of {TOTAL_ONBOARDING_STEPS}
                </p>
                <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-[#EDEDED] mb-3">
                  What's your gig?
                </h1>
                <p className="text-[14px] leading-relaxed" style={{ color: "#888888" }}>
                  Taxes are annoying. We get it. Tell us how you earn — we&apos;ll match deductions to your real work.
                </p>
              </div>

              <input
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                placeholder="Search gig types..."
                className="giga-input"
                autoFocus
              />

              <div className="grid grid-cols-2 gap-3">
                {filteredGigs.map((gig) => {
                  const selected = selectedGigs.includes(gig);
                  return (
                    <button
                      key={gig}
                      onClick={() => toggleGig(gig)}
                      className="flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-[13px] font-medium transition-all duration-150 active:scale-[0.97]"
                      style={
                        selected
                          ? { background: "rgba(0,255,133,0.08)", border: "1px solid rgba(0,255,133,0.35)", color: "#00FF85", boxShadow: "0 0 16px rgba(0,255,133,0.06)" }
                          : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#888888" }
                      }
                    >
                      <span
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                        style={{ background: selected ? "rgba(0,255,133,0.15)" : "rgba(255,255,255,0.05)", color: selected ? "#00FF85" : "#555555" }}
                      >
                        {GIG_ICONS[gig] ?? <Sparkles className="h-4 w-4" />}
                      </span>
                      {gig}
                      {selected && <CheckCircle2 className="ml-auto h-4 w-4 flex-shrink-0" style={{ color: "#00FF85" }} />}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3">
                {selectedGigs.length > 0 && (
                  <p className="text-center text-[12px]" style={{ color: "#888888" }}>
                    {selectedGigs.length} selected: <span style={{ color: "#00FF85" }}>{selectedGigs.join(", ")}</span>
                  </p>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="flex-1 rounded-2xl py-3.5 text-[13px] font-semibold transition-all duration-150"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#888888" }}
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(4)}
                    disabled={selectedGigs.length === 0}
                    className="flex-[2] flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-semibold transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
                    style={{ background: "#3B82F6", color: "#ffffff" }}
                  >
                    Continue → <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════ STEP 4 — State ══════════════════ */}
          {step === 4 && (
            <div className="animate-rise space-y-7">
              <div className="text-center">
                <p className="text-[11px] font-semibold tracking-[0.14em] uppercase mb-3" style={{ color: "rgba(0,255,133,0.75)" }}>
                  Step 4 of {TOTAL_ONBOARDING_STEPS}
                </p>
                <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-[#EDEDED] mb-3">
                  Where you live
                </h1>
              </div>

              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium" style={{ color: "#888888" }}>
                    State of residence
                  </span>
                  <select
                    value={residenceState}
                    onChange={(e) => setResidenceState(e.target.value)}
                    className="giga-input w-full"
                  >
                    <option value="TX">Texas</option>
                    <option value="_coming_soon" disabled>
                      More states coming soon
                    </option>
                  </select>
                </label>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="flex-1 rounded-2xl py-3.5 text-[13px] font-semibold transition-all duration-150"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#888888" }}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(5)}
                  className="flex-[2] flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-semibold transition-all duration-150 active:scale-[0.98]"
                  style={{ background: "#3B82F6", color: "#ffffff" }}
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════ STEP 5 — Connect accounts ══════════════════ */}
          {step === 5 && (
            <div className="animate-rise space-y-7">
              <div className="text-center">
                <p className="text-[11px] font-semibold tracking-[0.14em] uppercase mb-3" style={{ color: "rgba(59,130,246,0.8)" }}>
                  Step 5 of {TOTAL_ONBOARDING_STEPS}
                </p>
                <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-[#EDEDED] mb-3">
                  Connect your accounts
                </h1>
                <p className="text-[14px] leading-relaxed" style={{ color: "#888888" }}>
                  Link where you get paid. We import income and activity so you&apos;re not retyping everything.
                </p>
              </div>

              <div className="space-y-2.5">
                {(integrationsExpanded ? integrations : integrations.slice(0, INTEGRATIONS_PREVIEW)).map((integration) => {
                  const connected = integration.connected;
                  // Pick a platform icon by id
                  const PlatformIcon = {
                    bank:    ShieldCheck,
                    stripe:  BarChart3,
                    twitch:  Radio,
                    youtube: Video,
                    paypal:  Sparkles,
                    patreon: Music,
                  }[integration.id] ?? Link2;

                  const burstKey = connectMoneyBurst[integration.id];

                  return (
                    <div
                      key={integration.id}
                      className="relative flex items-center justify-between rounded-2xl px-5 py-4 transition-all duration-150"
                      style={{
                        background: connected ? "rgba(0,255,133,0.04)" : "rgba(255,255,255,0.03)",
                        border: connected ? "1px solid rgba(0,255,133,0.2)" : "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <div className="relative z-[2] flex items-center gap-4">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0"
                          style={{ background: connected ? "rgba(0,255,133,0.1)" : "rgba(255,255,255,0.05)" }}
                        >
                          <PlatformIcon className="h-5 w-5" style={{ color: connected ? "#00FF85" : "#555555" }} />
                        </div>
                        <div>
                          <p className="text-[14px] font-semibold text-[#EDEDED]">{integration.name}</p>
                          <p className="text-[11px]" style={{ color: "#555555" }}>
                            {connected && integration.lastSyncAt
                              ? `Synced ${new Date(integration.lastSyncAt).toLocaleDateString()}`
                              : integration.description}
                          </p>
                        </div>
                      </div>
                      <div className="relative z-[2] flex-shrink-0">
                        {burstKey != null && (
                          <div
                            key={burstKey}
                            className="connect-money-burst pointer-events-none absolute inset-0 z-0 overflow-visible rounded-xl"
                            aria-hidden
                          >
                            {[0, 1, 2, 3, 4].map((i) => (
                              <span
                                key={i}
                                className="connect-money-piece mn"
                                style={
                                  {
                                    "--x": `${-20 + i * 10}px`,
                                    "--drift": `${-12 + i * 6}px`,
                                    "--rot": `${-8 + i * 4}deg`,
                                    "--delay": `${i * 55}ms`,
                                    left: "50%",
                                    top: "10%",
                                  } as React.CSSProperties
                                }
                              >
                                $
                              </span>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleIntegrationConnect(integration)}
                          className="relative z-[1] flex items-center gap-2 rounded-xl px-4 py-2 text-[12px] font-semibold transition-all duration-150 active:scale-[0.96]"
                          style={
                            connected
                              ? { background: "rgba(0,255,133,0.1)", border: "1px solid rgba(0,255,133,0.3)", color: "#00FF85" }
                              : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#EDEDED" }
                          }
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          {connected ? "Connected" : "Connect"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* See more / collapse */}
              {integrations.length > INTEGRATIONS_PREVIEW && (
                <button
                  onClick={() => setIntegrationsExpanded((v) => !v)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-semibold transition-all duration-150"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#888888",
                  }}
                >
                  {integrationsExpanded ? (
                    <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" />
                      {`${integrations.length - INTEGRATIONS_PREVIEW} more platforms`}
                    </>
                  )}
                </button>
              )}

              <p className="text-center text-[12px]" style={{ color: "#555555" }}>
                🔒 Read-only access · We never move your money
              </p>

              <p className="text-center text-[12px]" style={{ color: "#555555" }}>
                You can connect more sources later from Settings.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(4)}
                  className="flex-1 rounded-2xl py-3.5 text-[13px] font-semibold transition-all duration-150"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#888888" }}
                >
                  ← Back
                </button>
                <button
                  onClick={() => setStep(6)}
                  className="flex-[2] flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-semibold transition-all duration-150 active:scale-[0.98]"
                  style={{ background: "#3B82F6", color: "#ffffff" }}
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════ STEP 6 — Upload 1099s ══════════════════ */}
          {step === 6 && (
            <div className="animate-rise space-y-7">
              <div className="text-center">
                <p className="text-[11px] font-semibold tracking-[0.14em] uppercase mb-3" style={{ color: "rgba(59,130,246,0.8)" }}>
                  Step 6 of {TOTAL_ONBOARDING_STEPS}
                </p>
                <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-[#EDEDED] mb-3">
                  Got a 1099? Drop it here.
                </h1>

                {integration1099Subheading.kind === "payouts" ? (
                  <>
                    <p className="text-[14px] mt-2 leading-relaxed max-w-[480px] mx-auto" style={{ color: "#a3a3a3" }}>
                      {integration1099Subheading.line1}
                    </p>
                    <p className="text-[14px] mt-2 leading-relaxed max-w-[480px] mx-auto" style={{ color: "#888888" }}>
                      {integration1099Subheading.line2}
                    </p>
                  </>
                ) : (
                  <p className="text-[14px] mt-2 leading-relaxed max-w-[480px] mx-auto" style={{ color: "#a3a3a3" }}>
                    {integration1099Subheading.text}
                  </p>
                )}
              </div>

              {/* ── Drop zone ── */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className="relative flex flex-col items-center justify-center rounded-2xl cursor-pointer transition-all duration-200 select-none"
                style={{
                  minHeight: "180px",
                  padding: "36px 24px",
                  background: isDragging
                    ? "rgba(59,130,246,0.07)"
                    : "rgba(255,255,255,0.02)",
                  border: isDragging
                    ? "2px dashed rgba(59,130,246,0.6)"
                    : "2px dashed rgba(255,255,255,0.1)",
                  boxShadow: isDragging
                    ? "0 0 0 4px rgba(59,130,246,0.08), inset 0 0 40px rgba(59,130,246,0.04)"
                    : "none",
                }}
              >
                {/* Icon cluster */}
                <div className="relative mb-4">
                  {/* Glow behind icon */}
                  {isDragging && (
                    <div
                      className="absolute inset-0 rounded-full blur-xl opacity-60"
                      style={{ background: "#3B82F6", width: "56px", height: "56px", transform: "translate(-4px,-4px)" }}
                    />
                  )}
                  <div
                    className="relative flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-200"
                    style={{
                      background: isDragging ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.05)",
                      border: isDragging ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <UploadCloud
                      className="h-6 w-6 transition-transform duration-200"
                      style={{
                        color: isDragging ? "#3B82F6" : "#555555",
                        transform: isDragging ? "translateY(-2px)" : "none",
                      }}
                    />
                  </div>
                </div>

                <p className="text-[14px] font-semibold text-[#EDEDED] mb-1">
                  {isDragging ? "Drop to upload" : "Drop 1099 files here"}
                </p>
                <p className="text-[12px]" style={{ color: "#555555" }}>
                  or{" "}
                  <span className="font-medium" style={{ color: "#3B82F6" }}>
                    click to browse
                  </span>
                  {" "}· PDF, PNG, JPG up to 20 MB each
                </p>

                {/* Supported form types */}
                <div className="flex items-center gap-2 mt-4">
                  {["1099-K", "1099-NEC", "1099-MISC"].map((t) => (
                    <span
                      key={t}
                      className="chip"
                      style={{ background: "rgba(255,255,255,0.05)", color: "#555555" }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />

              {/* ── Uploaded files list ── */}
              {forms.length > 0 && (
                <div className="space-y-2">
                  {/* Income tally */}
                  {totalDetectedIncome > 0 && (
                    <div
                      className="flex items-center justify-between rounded-xl px-4 py-3 mb-3"
                      style={{
                        background: "rgba(0,255,133,0.05)",
                        border: "1px solid rgba(0,255,133,0.2)",
                      }}
                    >
                      <p className="text-[12px] font-medium" style={{ color: "#888888" }}>
                        Total 1099 income detected
                      </p>
                      <p className="mn text-[15px] font-bold" style={{ color: "#00FF85" }}>
                        ${totalDetectedIncome.toLocaleString()}
                      </p>
                    </div>
                  )}

                  {forms.map((form) => (
                    <div
                      key={form.id}
                      className="flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200"
                      style={{
                        background: form.status === "done"
                          ? "rgba(0,255,133,0.03)"
                          : "rgba(255,255,255,0.03)",
                        border: form.status === "done"
                          ? "1px solid rgba(0,255,133,0.15)"
                          : "1px solid rgba(255,255,255,0.07)",
                      }}
                    >
                      {/* File icon */}
                      <div
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                        style={{
                          background: form.status === "done" ? "rgba(0,255,133,0.1)" : "rgba(255,255,255,0.05)",
                        }}
                      >
                        {form.status === "pending" ? (
                          <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#3B82F6" }} />
                        ) : (
                          <FileText className="h-4 w-4" style={{ color: "#00FF85" }} />
                        )}
                      </div>

                      {/* File info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[#EDEDED] truncate">{form.name}</p>
                        {form.status === "pending" ? (
                          <p className="text-[11px]" style={{ color: "#3B82F6" }}>Scanning…</p>
                        ) : (
                          <p className="text-[11px]" style={{ color: "#555555" }}>
                            {form.payer} · {formatBytes(form.size)}
                          </p>
                        )}
                      </div>

                      {/* Parsed income */}
                      {form.status === "done" && form.income && (
                        <p className="mn text-[13px] font-semibold flex-shrink-0" style={{ color: "#00FF85" }}>
                          +${form.income.toLocaleString()}
                        </p>
                      )}

                      {/* Remove */}
                      <button
                        onClick={() => removeForm(form.id)}
                        className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-150"
                        style={{ color: "#555555" }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#555555")}
                        aria-label="Remove file"
                      >
                        {form.status === "pending" ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Skip hint */}
              <p className="text-center text-[12px]" style={{ color: "#555555" }}>
                No 1099s yet? You can upload them later from the Receipt Capture page.
              </p>

              {saveError ? (
                <p className="text-center text-[12px]" style={{ color: "#F87171" }}>
                  {saveError}
                </p>
              ) : null}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(5)}
                  className="flex-1 rounded-2xl py-3.5 text-[13px] font-semibold transition-all duration-150"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#888888" }}
                >
                  ← Back
                </button>
                <button
                  onClick={() => void handleFinish()}
                  disabled={isSaving}
                  className="flex-[2] flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-semibold transition-all duration-150 disabled:opacity-40 active:scale-[0.98]"
                  style={{ background: "#00FF85", color: "#050505" }}
                >
                  {isSaving ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Crunching…</>
                  ) : forms.length > 0 ? (
                    <><CheckCircle2 className="h-4 w-4" /> Continue with uploads</>
                  ) : (
                    <><ArrowRight className="h-4 w-4" /> Continue without uploads</>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════ STEP 7 — You're in ══════════════════ */}
          {step === 7 && (
            <div className="animate-rise text-center space-y-8 relative overflow-visible">
              <div className="onboarding-confetti" aria-hidden="true" style={{ zIndex: 0 }}>
                {Array.from({ length: 26 }).map((_, i) => (
                  <span
                    key={i}
                    style={
                      {
                        "--delay": `${i * 42}ms`,
                        "--x": `${6 + (i * 17) % 88}%`,
                        "--dx": `${(i % 7) * 14 - 42}px`,
                        "--c": ["#00FF85", "#3B82F6", "#A855F7", "#F59E0B", "#EDEDED"][i % 5],
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>

              <div className="relative z-10 flex items-center justify-center">
                <div className="relative flex h-36 w-36 items-center justify-center">
                  <div
                    className="pointer-events-none absolute rounded-full success-check-ring"
                    style={{
                      width: "132px",
                      height: "132px",
                      background: "radial-gradient(circle, rgba(0,255,133,0.35) 0%, transparent 70%)",
                      filter: "blur(2px)",
                    }}
                  />
                  <div
                    className="pointer-events-none absolute rounded-full success-check-ring"
                    style={{
                      width: "168px",
                      height: "168px",
                      border: "2px solid rgba(0,255,133,0.35)",
                      opacity: 0.55,
                    }}
                  />
                  <div className="absolute inset-0 rounded-full blur-2xl opacity-45" style={{ background: "#00FF85" }} />
                  <div
                    className="relative flex h-20 w-20 items-center justify-center rounded-full"
                    style={{
                      background: "rgba(0,255,133,0.12)",
                      border: "1px solid rgba(0,255,133,0.45)",
                      boxShadow: "0 0 48px rgba(0,255,133,0.35)",
                    }}
                  >
                    <CheckCircle2 className="h-9 w-9" style={{ color: "#00FF85" }} />
                  </div>
                </div>
              </div>

              <div className="relative z-10">
                <h1 className="text-[1.75rem] sm:text-[1.95rem] font-extrabold leading-[1.2] tracking-tight text-[#EDEDED] mb-3">
                  You&apos;re in. Let&apos;s maximize what you keep.
                </h1>
                <p className="text-[14px] leading-relaxed" style={{ color: "#888888" }}>
                  We&apos;re updating your numbers in the background. Your overview is ready when you are.
                </p>
              </div>

              <div className="relative z-10 space-y-2 text-left">
                {[
                  { icon: <BarChart3 className="h-4 w-4" />, text: "Savings tally that updates as you confirm deductions" },
                  { icon: <Sparkles className="h-4 w-4" />, text: "Sorted transactions — edit categories anytime" },
                  { icon: <Zap className="h-4 w-4" />, text: "Mileage tool — estimate business miles from fuel spend" },
                ].map(({ icon, text }) => (
                  <div
                    key={text}
                    className="flex items-center gap-3 rounded-xl px-4 py-3"
                    style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <span style={{ color: "#00FF85" }}>{icon}</span>
                    <p className="text-[13px] text-[#EDEDED]">{text}</p>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="relative z-10 giga-cta-shimmer w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-extrabold transition-all duration-150 active:scale-[0.98]"
                style={{
                  background: "#00FF85",
                  color: "#0a0a0f",
                  boxShadow: "0 0 40px rgba(0,255,133,0.35), 0 12px 30px rgba(0,0,0,0.55)",
                }}
              >
                <span className="flex items-center justify-center gap-2">
                  <span>Enter</span>
                  <GigaTaxWordmark size="md" tone="onAccent" />
                  <ArrowRight className="h-5 w-5 shrink-0" aria-hidden />
                </span>
              </button>
            </div>
          )}

        </div>
      </main>

      <footer className="relative z-10 pb-6 text-center">
        <p className="text-[11px] flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5" style={{ color: "#333333" }}>
          <GigaTaxWordmark size="xs" tone="subtle" />
          <span>· independent work · tax year 2026</span>
        </p>
      </footer>
    </div>
  );
}

import { Navigate, Route, Routes } from "react-router-dom";
import { AccessGuard } from "./components/AccessGuard";
import { RequireAuth } from "./components/auth/RequireAuth";
import { AppShell } from "./components/layout/AppShell";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FilingPrepPage } from "./pages/FilingPrepPage";
import { LandingPage } from "./pages/LandingPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { OptimizationPage } from "./pages/OptimizationPage";
import { ReceiptCapturePage } from "./pages/ReceiptCapturePage";
import { SettingsPage } from "./pages/SettingsPage";
import { WaitlistAccessPage } from "./pages/WaitlistAccessPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/waitlist" element={<WaitlistAccessPage />} />
      <Route path="/start" element={<AccessGuard><OnboardingPage /></AccessGuard>} />
      <Route path="/onboarding" element={<Navigate to="/start" replace />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />

      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/receipts" element={<ReceiptCapturePage />} />
        <Route path="/optimization" element={<OptimizationPage />} />
        <Route path="/review" element={<FilingPrepPage />} />
        <Route path="/filing-prep" element={<FilingPrepPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

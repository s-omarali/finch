import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { createPlaidLinkToken, exchangePlaidPublicToken, syncAllPlaidTransactions } from "../services/api";

/**
 * Shared Plaid Link connect flow: request a link token, open Plaid Link,
 * exchange the resulting public token, and sync transactions.
 *
 * Used by both OnboardingPage (step 5, "Connect your accounts") and
 * SettingsPage ("Connected Accounts") so the flow only lives in one place.
 */
export function usePlaidConnect(onConnected: () => void | Promise<void>) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      await exchangePlaidPublicToken({ public_token: publicToken });
      await syncAllPlaidTransactions();
      setIsConnecting(false);
      setLinkToken(null);
      await onConnected();
    },
    [onConnected]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken) => {
      void onSuccess(publicToken);
    },
    onExit: () => {
      setIsConnecting(false);
    },
  });

  useEffect(() => {
    if (!linkToken || !ready || !isConnecting) return;
    open();
  }, [isConnecting, open, linkToken, ready]);

  const startConnect = useCallback(async () => {
    try {
      setIsConnecting(true);
      const tokenResponse = await createPlaidLinkToken();
      setLinkToken(tokenResponse.link_token);
    } catch {
      setIsConnecting(false);
    }
  }, []);

  return { startConnect, isConnecting };
}

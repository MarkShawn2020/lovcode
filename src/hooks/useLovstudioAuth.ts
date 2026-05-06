import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/i18n";

const LOVSTUDIO_AUTH_QUERY_KEY = ["lovstudioAuthState"] as const;

export interface LovstudioAuthUser {
  id: string;
  email: string;
}

export interface LovstudioAuthState {
  expiresAt: number;
  user: LovstudioAuthUser;
}

interface LovstudioLoginStartResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface ActiveLovstudioLoginFlow extends LovstudioLoginStartResult {
  startedAt: number;
}

interface LovstudioLoginPollResult {
  status: "pending" | "authenticated";
  session?: LovstudioAuthState | null;
}

export function useLovstudioAuth() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [loginFlow, setLoginFlow] = useState<ActiveLovstudioLoginFlow | null>(null);
  const [loginPolling, setLoginPolling] = useState(false);

  const { data: authState = null, isLoading: authLoading } = useQuery({
    queryKey: LOVSTUDIO_AUTH_QUERY_KEY,
    queryFn: () => invoke<LovstudioAuthState | null>("get_lovstudio_auth_state"),
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const startLogin = useCallback(async (appVersion?: string) => {
    try {
      const result = await invoke<LovstudioLoginStartResult>("start_lovstudio_login", {
        appVersion,
      });
      setLoginFlow({ ...result, startedAt: Date.now() });
      await openUrl(result.verificationUriComplete);
      toast.success(t("auth.openedLogin"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t("auth.loginStartFailed", { message }));
    }
  }, [t]);

  const logout = useCallback(async () => {
    try {
      await invoke("logout_lovstudio");
      setLoginFlow(null);
      queryClient.setQueryData(LOVSTUDIO_AUTH_QUERY_KEY, null);
      toast.success(t("auth.loggedOut"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t("auth.logoutFailed", { message }));
    }
  }, [queryClient, t]);

  useEffect(() => {
    if (!loginFlow || authState) return;

    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      if (cancelled) return;

      if (Date.now() - loginFlow.startedAt > loginFlow.expiresIn * 1000) {
        setLoginFlow(null);
        setLoginPolling(false);
        toast.error(t("auth.loginExpired"));
        return;
      }

      setLoginPolling(true);
      try {
        const result = await invoke<LovstudioLoginPollResult>("poll_lovstudio_login", {
          deviceCode: loginFlow.deviceCode,
        });
        if (cancelled) return;
        if (result.status === "authenticated" && result.session) {
          queryClient.setQueryData(LOVSTUDIO_AUTH_QUERY_KEY, result.session);
          setLoginFlow(null);
          toast.success(t("auth.loggedIn"));
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoginFlow(null);
        toast.error(t("auth.loginFailed", { message }));
      } finally {
        if (!cancelled) setLoginPolling(false);
      }
    };

    void poll();
    timer = window.setInterval(poll, Math.max(loginFlow.interval, 3) * 1000);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [authState, loginFlow, queryClient, t]);

  return {
    authState,
    authLoading,
    loginFlow,
    loginPolling,
    startLogin,
    logout,
  };
}

/**
 * StatusBar - Bottom status bar displaying app info, stats, time, network, etc.
 */
import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import { profileAtom, workspaceDataAtom } from "../store";
import { invoke } from "@tauri-apps/api/core";
import {
  FolderIcon,
  GitBranchIcon,
  CodeIcon,
  GlobeIcon,
  ShieldCheckIcon,
  UserIcon,
  ClockIcon,
} from "lucide-react";

const VERSION = "0.24.5";

interface NetworkInfo {
  region: string;
  ip: string;
  isProxy: boolean;
  proxyType?: string;
}

interface TodayStats {
  lines_added: number;
  lines_deleted: number;
}

export function StatusBar() {
  const [workspace] = useAtom(workspaceDataAtom);
  const [profile] = useAtom(profileAtom);
  const [time, setTime] = useState(new Date());
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [todayStats, setTodayStats] = useState<TodayStats>({ lines_added: 0, lines_deleted: 0 });
  const [proxyEnv, setProxyEnv] = useState<string | null>(null);

  // Clock update
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch network info
  useEffect(() => {
    async function fetchNetworkInfo() {
      try {
        const res = await fetch("https://ipinfo.io/json");
        if (res.ok) {
          const data = await res.json();
          setNetworkInfo({
            region: data.city ? `${data.city}, ${data.country}` : data.country || "Unknown",
            ip: data.ip || "",
            isProxy: data.privacy?.proxy || data.privacy?.vpn || false,
            proxyType: data.privacy?.vpn ? "VPN" : data.privacy?.proxy ? "Proxy" : undefined,
          });
        }
      } catch {
        // Silently fail - network info is optional
      }
    }
    fetchNetworkInfo();
  }, []);

  // Check proxy environment
  useEffect(() => {
    async function checkProxy() {
      try {
        const envProxy = await invoke<string | null>("get_env_var", { name: "HTTP_PROXY" });
        const envHttpsProxy = await invoke<string | null>("get_env_var", { name: "HTTPS_PROXY" });
        const proxy = envProxy || envHttpsProxy;
        if (proxy) {
          // Extract host from proxy URL
          try {
            const url = new URL(proxy);
            setProxyEnv(url.hostname);
          } catch {
            setProxyEnv(proxy.slice(0, 20));
          }
        }
      } catch {
        // get_env_var might not exist, that's fine
      }
    }
    checkProxy();
  }, []);

  // Fetch today's coding stats
  useEffect(() => {
    async function fetchTodayStats() {
      try {
        const stats = await invoke<TodayStats>("get_today_coding_stats");
        setTodayStats(stats);
      } catch {
        // Command might not exist yet
      }
    }
    fetchTodayStats();
    // Refresh every 30 seconds
    const timer = setInterval(fetchTodayStats, 30000);
    return () => clearInterval(timer);
  }, []);

  // Calculate stats from workspace
  const projectCount = workspace?.projects?.length ?? 0;
  const featCount = workspace?.projects?.reduce(
    (sum, p) => sum + (p.features?.length ?? 0),
    0
  ) ?? 0;

  const formatTime = (d: Date) => {
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const formatDate = (d: Date) => {
    return d.toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
      weekday: "short",
    });
  };

  return (
    <div className="h-6 bg-card border-t border-border flex items-center justify-between px-3 text-xs text-muted-foreground select-none">
      {/* Left: Product name & version */}
      <div className="flex items-center gap-4">
        <span className="font-medium text-ink">Lovcode</span>
        <span className="text-muted-foreground/70">v{VERSION}</span>

        {/* Stats */}
        <div className="flex items-center gap-3 ml-2 border-l border-border/50 pl-4">
          <div className="flex items-center gap-1" title="Projects">
            <FolderIcon className="w-3 h-3" />
            <span>{projectCount}</span>
          </div>
          <div className="flex items-center gap-1" title="Features">
            <GitBranchIcon className="w-3 h-3" />
            <span>{featCount}</span>
          </div>
          {(todayStats.lines_added > 0 || todayStats.lines_deleted > 0) && (
            <div className="flex items-center gap-1" title="Today's changes">
              <CodeIcon className="w-3 h-3" />
              <span className="text-green-600">+{todayStats.lines_added}</span>
              <span className="text-red-500">-{todayStats.lines_deleted}</span>
            </div>
          )}
        </div>
      </div>

      {/* Right: Time, Network, Account */}
      <div className="flex items-center gap-4">
        {/* Proxy indicator */}
        {proxyEnv && (
          <div className="flex items-center gap-1 text-amber-600" title={`Proxy: ${proxyEnv}`}>
            <ShieldCheckIcon className="w-3 h-3" />
            <span>中转</span>
          </div>
        )}

        {/* Network region */}
        {networkInfo && (
          <div className="flex items-center gap-1" title={`IP: ${networkInfo.ip}`}>
            <GlobeIcon className="w-3 h-3" />
            <span>{networkInfo.region}</span>
            {networkInfo.isProxy && (
              <span className="text-amber-600 ml-1">({networkInfo.proxyType || "Proxy"})</span>
            )}
          </div>
        )}

        {/* Date & Time */}
        <div className="flex items-center gap-1 border-l border-border/50 pl-4">
          <ClockIcon className="w-3 h-3" />
          <span>{formatDate(time)}</span>
          <span className="font-mono">{formatTime(time)}</span>
        </div>

        {/* Account */}
        {profile.nickname && (
          <div className="flex items-center gap-1 border-l border-border/50 pl-4">
            <UserIcon className="w-3 h-3" />
            <span>{profile.nickname}</span>
          </div>
        )}
      </div>
    </div>
  );
}

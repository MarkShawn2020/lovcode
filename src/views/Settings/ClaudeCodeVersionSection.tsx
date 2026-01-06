import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { CollapsibleCard } from "../../components/shared";
import type { ClaudeCodeVersionInfo, ClaudeCodeInstallType } from "../../types";

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const INSTALL_TYPES: { value: ClaudeCodeInstallType; label: string; desc: string }[] = [
  { value: "native", label: "Native", desc: "Recommended, no dependencies" },
  { value: "npm", label: "NPM", desc: "Requires Node.js" },
];

export function ClaudeCodeVersionSection() {
  const [versionInfo, setVersionInfo] = useState<ClaudeCodeVersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string>("latest");
  const [selectedInstallType, setSelectedInstallType] = useState<ClaudeCodeInstallType>("native");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadVersionInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await invoke<ClaudeCodeVersionInfo>("get_claude_code_version_info");
      setVersionInfo(info);
      if (info.current_version) {
        setSelectedVersion(info.current_version);
      }
      // Set install type from detected type
      if (info.install_type !== "none") {
        setSelectedInstallType(info.install_type);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVersionInfo();
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    setSuccess(null);
    try {
      await invoke<string>("install_claude_code_version", {
        version: selectedVersion,
        installType: selectedInstallType,
      });
      const typeLabel = INSTALL_TYPES.find((t) => t.value === selectedInstallType)?.label;
      setSuccess(`Successfully installed Claude Code ${selectedVersion} (${typeLabel})`);
      await loadVersionInfo();
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const handleToggleAutoupdater = async () => {
    if (!versionInfo) return;
    try {
      await invoke("set_claude_code_autoupdater", { disabled: !versionInfo.autoupdater_disabled });
      setVersionInfo({ ...versionInfo, autoupdater_disabled: !versionInfo.autoupdater_disabled });
    } catch (e) {
      setError(String(e));
    }
  };

  if (loading) {
    return (
      <CollapsibleCard
        storageKey="lovcode:settings:ccVersionOpen"
        title="Claude Code Version"
        subtitle="Loading version information..."
        bodyClassName="p-3"
      >
        <p className="text-xs text-muted-foreground">Loading...</p>
      </CollapsibleCard>
    );
  }

  const isNotInstalled = versionInfo?.install_type === "none";
  const isCurrentVersion = versionInfo?.current_version === selectedVersion;
  const isSameInstallType = versionInfo?.install_type === selectedInstallType;
  const isLatest =
    selectedVersion === "latest" ||
    versionInfo?.available_versions[0]?.version === selectedVersion;

  // Determine button state
  const canInstall = !installing && (!isCurrentVersion || !isSameInstallType);
  const getButtonLabel = () => {
    if (installing) return "Installing...";
    if (isNotInstalled) return "Install";
    if (!isSameInstallType) return "Reinstall"; // Switching install type
    if (isCurrentVersion) return "Installed";
    if (isLatest) return "Update";
    return "Install";
  };

  const getSelectedVersionLabel = () => {
    if (selectedVersion === "latest") return "latest (newest)";
    const v = versionInfo?.available_versions.find((v) => v.version === selectedVersion);
    if (!v) return selectedVersion;
    const isCurrent = v.version === versionInfo?.current_version;
    return `${v.version}${isCurrent ? " (current)" : ""}`;
  };

  const getSubtitle = () => {
    if (!versionInfo) return "Error loading";
    if (isNotInstalled) return "Not installed";
    const typeLabel = INSTALL_TYPES.find((t) => t.value === versionInfo.install_type)?.label;
    return `v${versionInfo.current_version} (${typeLabel})`;
  };

  return (
    <CollapsibleCard
      storageKey="lovcode:settings:ccVersionOpen"
      title="Claude Code Version"
      subtitle={getSubtitle()}
      bodyClassName="p-3 space-y-3"
    >
      {/* Version + Install Type + Button */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          {/* Version selector */}
          <Select value={selectedVersion} onValueChange={setSelectedVersion} disabled={installing}>
            <SelectTrigger className="flex-1">
              <SelectValue>{getSelectedVersionLabel()}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">
                <span>latest (newest)</span>
              </SelectItem>
              {versionInfo?.available_versions.map((v) => {
                const isCurrent = v.version === versionInfo.current_version;
                return (
                  <SelectItem key={v.version} value={v.version}>
                    <span className="flex items-center justify-between w-full gap-3">
                      <span>
                        {v.version}
                        {isCurrent ? " (current)" : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ↓{formatDownloads(v.downloads)}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {/* Install type selector */}
          <Select
            value={selectedInstallType}
            onValueChange={(v) => setSelectedInstallType(v as ClaudeCodeInstallType)}
            disabled={installing}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INSTALL_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  <span className="flex flex-col">
                    <span>{t.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Install button */}
          <Button onClick={handleInstall} disabled={!canInstall} className="shrink-0">
            {getButtonLabel()}
          </Button>
        </div>

        {/* Install type hint */}
        <p className="text-[10px] text-muted-foreground">
          {INSTALL_TYPES.find((t) => t.value === selectedInstallType)?.desc}
          {!isSameInstallType && versionInfo?.install_type !== "none" && (
            <span className="text-amber-600"> (will switch from {versionInfo?.install_type})</span>
          )}
        </p>
      </div>

      {/* Auto-updater toggle */}
      {!isNotInstalled && (
        <div className="flex items-center justify-between gap-3 p-2 rounded-lg border border-border bg-card-alt">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink">Auto-updater</p>
            <p className="text-[10px] text-muted-foreground">
              {versionInfo?.autoupdater_disabled
                ? "Disabled - Claude Code won't update automatically"
                : "Enabled - Claude Code will update automatically"}
            </p>
          </div>
          <Button
            size="sm"
            variant={versionInfo?.autoupdater_disabled ? "default" : "outline"}
            onClick={handleToggleAutoupdater}
          >
            {versionInfo?.autoupdater_disabled ? "Enable" : "Disable"}
          </Button>
        </div>
      )}

      {/* Error/Success messages */}
      {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}
      {success && <p className="text-xs text-green-600 bg-green-50 rounded-lg p-2">{success}</p>}

      {!isNotInstalled && (
        <p className="text-[10px] text-muted-foreground">
          Tip: Disable auto-updater to lock a specific version for stability.
        </p>
      )}

      {/* NPM link */}
      <a
        href="https://www.npmjs.com/package/@anthropic-ai/claude-code?activeTab=versions"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] text-primary hover:underline inline-flex items-center gap-1"
      >
        View all versions on npm →
      </a>
    </CollapsibleCard>
  );
}

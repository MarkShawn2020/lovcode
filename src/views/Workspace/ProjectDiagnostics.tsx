import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  PlayIcon,
  CheckCircledIcon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  GearIcon,
  LockClosedIcon,
  CodeIcon,
} from "@radix-ui/react-icons";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "../../components/ui/collapsible";
import type { TechStack, EnvCheckResult } from "./types";

interface ProjectDiagnosticsProps {
  projectPath: string;
}

type DiagnosticStatus = "idle" | "loading" | "success" | "warning" | "error";

interface DiagnosticCardProps {
  title: string;
  icon: React.ReactNode;
  status: DiagnosticStatus;
  summary?: string;
  isExpanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}

function DiagnosticCard({
  title,
  icon,
  status,
  summary,
  isExpanded,
  onToggle,
  children,
}: DiagnosticCardProps) {
  const statusColors = {
    idle: "text-muted-foreground",
    loading: "text-blue-500",
    success: "text-green-500",
    warning: "text-amber-500",
    error: "text-red-500",
  };

  const statusIcons = {
    idle: null,
    loading: <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />,
    success: <CheckCircledIcon className="w-3.5 h-3.5 text-green-500" />,
    warning: <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500" />,
    error: <CrossCircledIcon className="w-3.5 h-3.5 text-red-500" />,
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <CollapsibleTrigger className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors cursor-pointer">
          <div className={`p-2 bg-muted rounded-lg ${statusColors[status]}`}>
            {icon}
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-ink">{title}</div>
            {summary && (
              <div className="text-xs text-muted-foreground">{summary}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {statusIcons[status]}
            {children && (
              <ChevronDownIcon
                className={`w-4 h-4 text-muted-foreground transition-transform ${
                  isExpanded ? "rotate-180" : ""
                }`}
              />
            )}
          </div>
        </CollapsibleTrigger>
        {children && (
          <CollapsibleContent>
            <div className="px-4 pb-3 border-t border-border pt-3">
              {children}
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
}

export function ProjectDiagnostics({ projectPath }: ProjectDiagnosticsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [techStack, setTechStack] = useState<TechStack | null>(null);
  const [envResult, setEnvResult] = useState<EnvCheckResult | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const runDiagnostics = async () => {
    setIsLoading(true);
    try {
      const [stack, env] = await Promise.all([
        invoke<TechStack>("diagnostics_detect_stack", { projectPath }),
        invoke<EnvCheckResult>("diagnostics_check_env", { projectPath }),
      ]);
      setTechStack(stack);
      setEnvResult(env);
    } catch (error) {
      console.error("Diagnostics failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getTechStackStatus = (): DiagnosticStatus => {
    if (isLoading) return "loading";
    if (!techStack) return "idle";
    return "success";
  };

  const getEnvStatus = (): DiagnosticStatus => {
    if (isLoading) return "loading";
    if (!envResult) return "idle";
    if (envResult.leaked_secrets.length > 0) return "error";
    if (envResult.missing_keys.length > 0) return "warning";
    return "success";
  };

  const getTechStackSummary = () => {
    if (!techStack) return "Click Run to detect";
    const parts = [techStack.runtime];
    if (techStack.package_manager) parts.push(techStack.package_manager);
    if (techStack.orm) parts.push(techStack.orm);
    return parts.join(" • ");
  };

  const getEnvSummary = () => {
    if (!envResult) return "Click Run to check";
    const issues = [];
    if (envResult.leaked_secrets.length > 0) {
      issues.push(`${envResult.leaked_secrets.length} leaked`);
    }
    if (envResult.missing_keys.length > 0) {
      issues.push(`${envResult.missing_keys.length} missing`);
    }
    if (issues.length === 0) return "All good";
    return issues.join(", ");
  };

  return (
    <div className="flex-shrink-0 px-6 py-4 border-b border-border">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Diagnostics
        </h3>
        <button
          onClick={runDiagnostics}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-muted hover:bg-muted/80 rounded-lg transition-colors disabled:opacity-50"
        >
          {isLoading ? (
            <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <PlayIcon className="w-3 h-3" />
          )}
          Run All
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Tech Stack Card */}
        <DiagnosticCard
          title="Tech Stack"
          icon={<CodeIcon className="w-4 h-4" />}
          status={getTechStackStatus()}
          summary={getTechStackSummary()}
          isExpanded={expandedCard === "tech"}
          onToggle={() => setExpandedCard(expandedCard === "tech" ? null : "tech")}
        >
          {techStack && (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Runtime</span>
                <span className="text-ink font-medium">{techStack.runtime}</span>
              </div>
              {techStack.package_manager && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Package Manager</span>
                  <span className="text-ink font-medium">{techStack.package_manager}</span>
                </div>
              )}
              {techStack.orm && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ORM</span>
                  <span className="text-ink font-medium">{techStack.orm}</span>
                </div>
              )}
              {techStack.frameworks.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Frameworks</span>
                  <span className="text-ink font-medium">{techStack.frameworks.join(", ")}</span>
                </div>
              )}
            </div>
          )}
        </DiagnosticCard>

        {/* Env Check Card */}
        <DiagnosticCard
          title="Environment"
          icon={<LockClosedIcon className="w-4 h-4" />}
          status={getEnvStatus()}
          summary={getEnvSummary()}
          isExpanded={expandedCard === "env"}
          onToggle={() => setExpandedCard(expandedCard === "env" ? null : "env")}
        >
          {envResult && (
            <div className="space-y-3 text-xs">
              {/* File status */}
              <div className="flex gap-3">
                <span className={envResult.env_example_exists ? "text-green-600" : "text-muted-foreground"}>
                  {envResult.env_example_exists ? "✓" : "○"} .env.example
                </span>
                <span className={envResult.env_exists ? "text-green-600" : "text-amber-600"}>
                  {envResult.env_exists ? "✓" : "○"} .env
                </span>
              </div>

              {/* Missing keys */}
              {envResult.missing_keys.length > 0 && (
                <div>
                  <div className="text-amber-600 font-medium mb-1">
                    Missing Keys ({envResult.missing_keys.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {envResult.missing_keys.slice(0, 5).map((key) => (
                      <span
                        key={key}
                        className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px]"
                      >
                        {key}
                      </span>
                    ))}
                    {envResult.missing_keys.length > 5 && (
                      <span className="text-muted-foreground">
                        +{envResult.missing_keys.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Leaked secrets */}
              {envResult.leaked_secrets.length > 0 && (
                <div>
                  <div className="text-red-600 font-medium mb-1">
                    Leaked Secrets ({envResult.leaked_secrets.length})
                  </div>
                  <div className="space-y-1">
                    {envResult.leaked_secrets.slice(0, 3).map((leak, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px]">
                        <span className="text-red-600 font-mono truncate max-w-[100px]">
                          {leak.file}:{leak.line}
                        </span>
                        <span className="text-muted-foreground">{leak.key_name}</span>
                        <span className="font-mono text-red-400">{leak.preview}</span>
                      </div>
                    ))}
                    {envResult.leaked_secrets.length > 3 && (
                      <div className="text-muted-foreground">
                        +{envResult.leaked_secrets.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* All good */}
              {envResult.missing_keys.length === 0 && envResult.leaked_secrets.length === 0 && (
                <div className="text-green-600">
                  ✓ No issues found
                </div>
              )}
            </div>
          )}
        </DiagnosticCard>
      </div>
    </div>
  );
}

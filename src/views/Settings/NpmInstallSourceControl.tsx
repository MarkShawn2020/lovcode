import { Check } from "lucide-react";
import { useI18n, type Language, type TranslationKey } from "../../i18n";
import { cn } from "../../lib/utils";

export type NpmInstallRegistry = "default" | "china_mirror";

const NPM_INSTALL_REGISTRY_OPTIONS: Array<{
  value: NpmInstallRegistry;
  labelKey: TranslationKey;
}> = [
  { value: "default", labelKey: "agentRuntime.installSourceDefaultNpm" },
  { value: "china_mirror", labelKey: "agentRuntime.installSourceChinaMirror" },
];

export function getDefaultNpmInstallRegistry(language: Language): NpmInstallRegistry {
  return language === "zh" ? "china_mirror" : "default";
}

export function NpmInstallSourceControl({
  value,
  onValueChange,
  disabled,
  showLabel = true,
  showHint = true,
}: {
  value: NpmInstallRegistry;
  onValueChange: (value: NpmInstallRegistry) => void;
  disabled?: boolean;
  showLabel?: boolean;
  showHint?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-1.5">
      {showLabel && (
        <p className="px-1 text-xs font-medium text-muted-foreground">
          {t("agentRuntime.installSource")}
        </p>
      )}
      <div className="grid grid-cols-2 gap-1">
        {NPM_INSTALL_REGISTRY_OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onValueChange(option.value)}
              className={cn(
                "flex h-8 items-center justify-between rounded-md border px-2 text-left text-xs transition-colors disabled:opacity-50",
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background text-foreground hover:bg-accent",
              )}
            >
              <span className="min-w-0 truncate">{t(option.labelKey)}</span>
              {active && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          );
        })}
      </div>
      {showHint && value === "china_mirror" && (
        <p className="px-1 text-xs leading-4 text-muted-foreground">
          {t("agentRuntime.installSourceChinaMirrorHint")}
        </p>
      )}
    </div>
  );
}

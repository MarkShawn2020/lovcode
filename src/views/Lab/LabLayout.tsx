import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { useI18n } from "@/i18n";
import { LAB_SECTIONS, type LabActiveKey } from "./labNavigation";

interface LabLayoutProps {
  active: LabActiveKey;
  children: ReactNode;
}

export function LabLayout({ active, children }: LabLayoutProps) {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-border bg-card">
        <div className="p-3">
          <button
            type="button"
            onClick={() => navigate("/lab")}
            className={`group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
              active === "lab"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-card-alt hover:text-foreground"
            }`}
            title={t("lab.backToLab")}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
              {active === "lab" ? <FlaskConical className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{t("lab.home")}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{t("common.lab")}</span>
            </span>
          </button>

          <div className="mt-5 px-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t("lab.collection")}
          </div>
          <nav className="mt-2 flex flex-col gap-0.5">
            {LAB_SECTIONS.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.key;

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-card-alt hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t(item.titleKey)}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}

import { useNavigate } from "react-router-dom";
import { ArrowUpRight, FlaskConical } from "lucide-react";
import { useI18n } from "@/i18n";
import { LAB_SECTIONS, LabLayout, type LabSection } from "@/views/Lab";

export default function LabPage() {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <LabLayout active="lab">
      <div className="h-full overflow-auto bg-canvas">
        <div className="mx-auto max-w-5xl px-8 py-12">
          <header className="border-b border-border pb-8">
            <div className="mb-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              <span className="h-px w-8 bg-border" />
              <span>{t("lab.kicker")}</span>
              <span className="h-1 w-1 rounded-full bg-primary/60" />
              <span>{t("lab.itemCount", { count: LAB_SECTIONS.length })}</span>
            </div>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="font-serif text-5xl leading-tight text-foreground">
                  {t("common.lab")}
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {t("lab.subtitle")}
                </p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-card text-primary">
                <FlaskConical className="h-5 w-5" />
              </div>
            </div>
          </header>

          <section className="mt-10" aria-label={t("lab.collection")}>
            <div className="mb-4 flex items-baseline justify-between border-b border-border pb-3">
              <h2 className="font-serif text-sm uppercase tracking-[0.18em] text-foreground">
                {t("lab.collection")}
              </h2>
              <span className="text-xs text-muted-foreground">
                {t("lab.itemCount", { count: LAB_SECTIONS.length })}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {LAB_SECTIONS.map((item) => (
                <LabCard
                  key={item.path}
                  item={item}
                  onClick={() => navigate(item.path)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </LabLayout>
  );
}

function LabCard({
  item,
  onClick,
}: {
  item: LabSection;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-48 flex-col justify-between rounded-2xl border border-border bg-card p-5 text-left transition-[background-color,border-color] hover:border-primary/40 hover:bg-card-alt"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground/50 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      <div className="mt-8">
        <h3 className="font-serif text-xl leading-tight text-foreground">
          {t(item.titleKey)}
        </h3>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {t(item.descriptionKey)}
        </p>
      </div>
    </button>
  );
}

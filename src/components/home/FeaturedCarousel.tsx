import { StarFilledIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { useI18n } from "@/i18n";

interface FeaturedCarouselProps {
  onOpenAnnualReport: () => void;
}

export function FeaturedCarousel({ onOpenAnnualReport }: FeaturedCarouselProps) {
  const { t } = useI18n();
  return (
    <button
      onClick={onOpenAnnualReport}
      className="w-full h-32 p-6 rounded-2xl
                 bg-gradient-to-r from-primary via-primary/80 to-amber-500/60
                 text-left border border-white/20 shadow-lg
                 hover:scale-[1.02] transition-transform duration-200
                 relative overflow-hidden group"
    >
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.15),transparent_50%)]" />
      <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/10 rounded-full blur-2xl group-hover:scale-110 transition-transform" />

      <div className="relative flex items-center justify-between h-full">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white/60 text-xs font-medium tracking-wide uppercase">
              {t("home.annualReport")}
            </span>
          </div>
          <h3 className="font-serif text-2xl font-bold text-white mb-1">
            {t("home.yearInReview2025")}
          </h3>
          <p className="text-white/80 text-sm">
            {t("home.codingJourney")}
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <StarFilledIcon className="w-10 h-10 text-white/90" />
          <div className="flex items-center gap-1 text-white/70 text-xs">
            <span>{t("home.view")}</span>
            <ChevronRightIcon className="w-3 h-3" />
          </div>
        </div>
      </div>
    </button>
  );
}

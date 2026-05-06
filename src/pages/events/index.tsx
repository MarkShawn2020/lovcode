import { useNavigate } from "react-router-dom";
import { FeaturedCarousel } from "../../components/home";
import { useI18n } from "@/i18n";
import { LabLayout } from "@/views/Lab";

export default function EventsPage() {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <LabLayout active="events">
      <div className="flex h-full flex-col overflow-auto px-6 py-8">
        <div className="max-w-4xl mx-auto w-full">
          <h1 className="font-serif text-3xl text-foreground mb-6 tracking-tight">{t("common.events")}</h1>
          <div className="space-y-4">
            <FeaturedCarousel onOpenAnnualReport={() => navigate("/annual-report-2025")} />
          </div>
        </div>
      </div>
    </LabLayout>
  );
}

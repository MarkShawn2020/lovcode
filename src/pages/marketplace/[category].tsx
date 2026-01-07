import { useNavigate, useParams } from "react-router-dom";
import { useAtom } from "jotai";
import { MarketplaceView, MarketplaceLayout } from "../../views/Marketplace";
import { marketplaceCategoryAtom } from "../../store";
import type { TemplateCategory } from "../../types";

export default function MarketplaceCategoryPage() {
  const navigate = useNavigate();
  const { category } = useParams<{ category: string }>();
  const [, setMarketplaceCategory] = useAtom(marketplaceCategoryAtom);

  const currentCategory = (category as TemplateCategory) || "skills";

  return (
    <MarketplaceLayout
      currentCategory={currentCategory}
      onCategoryClick={(cat) => navigate(`/marketplace/${cat}`)}
    >
      <MarketplaceView
        initialCategory={currentCategory}
        onSelectTemplate={(template, cat) => {
          setMarketplaceCategory(cat as TemplateCategory);
          const categoryPath = cat === "output-styles" ? "output-styles" : cat === "mcps" ? "mcp" : cat;
          navigate(`/${categoryPath}/${encodeURIComponent(template.name)}?source=marketplace`);
        }}
      />
    </MarketplaceLayout>
  );
}

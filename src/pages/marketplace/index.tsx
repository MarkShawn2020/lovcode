import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { MarketplaceView, MarketplaceLayout } from "../../views/Marketplace";
import { marketplaceCategoryAtom } from "../../store";
import type { TemplateCategory } from "../../types";

export default function MarketplacePage() {
  const navigate = useNavigate();
  const [marketplaceCategory, setMarketplaceCategory] = useAtom(marketplaceCategoryAtom);

  return (
    <MarketplaceLayout
      currentCategory={marketplaceCategory}
      onCategoryClick={(cat) => navigate(`/marketplace/${cat}`)}
    >
      <MarketplaceView
        initialCategory={marketplaceCategory}
        onSelectTemplate={(template, cat) => {
          setMarketplaceCategory(cat as TemplateCategory);
          const categoryPath = cat === "output-styles" ? "output-styles" : cat === "mcps" ? "mcp" : cat;
          navigate(`/${categoryPath}/${encodeURIComponent(template.name)}?source=marketplace`);
        }}
      />
    </MarketplaceLayout>
  );
}

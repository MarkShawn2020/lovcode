import { TargetIcon, StarFilledIcon, HeartFilledIcon, GlobeIcon } from "@radix-ui/react-icons";
import type { LocalSkill, TemplateComponent } from "../../types";
import {
  LoadingState,
  EmptyState,
  SearchInput,
  PageHeader,
  ConfigPage,
  useSearch,
} from "../../components/config";
import { useInvokeQuery } from "../../hooks";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { MarketplaceContent } from "../Marketplace";

/** Convert LocalSkill to TemplateComponent for unified detail view */
function skillToTemplate(skill: LocalSkill): TemplateComponent {
  return {
    name: skill.name,
    path: skill.path,
    category: "skill",
    component_type: "skill",
    description: skill.description,
    downloads: skill.marketplace?.downloads ?? null,
    content: skill.content,
    source_id: skill.marketplace?.source_id ?? null,
    source_name: skill.marketplace?.source_name ?? null,
    author: skill.marketplace?.author ?? null,
  };
}

interface SkillsViewProps {
  onSelectTemplate: (template: TemplateComponent, localPath: string) => void;
  onMarketplaceSelect: (template: TemplateComponent) => void;
}

export function SkillsView({ onSelectTemplate, onMarketplaceSelect }: SkillsViewProps) {
  const { data: skills = [], isLoading } = useInvokeQuery<LocalSkill[]>(["skills"], "list_local_skills");
  const { search, setSearch, filtered } = useSearch(skills, ["name", "description"]);

  return (
    <ConfigPage>
      <PageHeader
        title="Skills"
        subtitle={`${skills.length} skills in ~/.claude/skills`}
      />

      <Tabs defaultValue="installed" className="flex-1 flex flex-col">
        <TabsList className="bg-card-alt border border-border">
          <TabsTrigger value="installed">已安装</TabsTrigger>
          <TabsTrigger value="marketplace">市场</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-4">
          {isLoading ? (
            <LoadingState message="Loading skills..." />
          ) : (
            <>
              <SearchInput
                placeholder="Search installed skills..."
                value={search}
                onChange={setSearch}
              />

              {filtered.length > 0 && (
                <div className="space-y-2">
                  {filtered.map((skill) => {
                    const meta = skill.marketplace;
                    const hasMarketplaceInfo = meta?.source_id && meta.source_id !== "personal";
                    return (
                      <button
                        key={skill.name}
                        onClick={() => onSelectTemplate(skillToTemplate(skill), skill.path)}
                        className="w-full text-left bg-card rounded-xl p-4 border border-border hover:border-primary transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-ink truncate">{skill.name}</p>
                              {hasMarketplaceInfo && (
                                <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                                  meta?.source_id === "anthropic"
                                    ? "bg-amber-500/10 text-amber-600"
                                    : meta?.source_id === "lovstudio"
                                      ? "bg-primary/10 text-primary"
                                      : "bg-muted text-muted-foreground"
                                }`}>
                                  {meta?.source_id === "anthropic" ? (
                                    <StarFilledIcon className="w-3 h-3 inline mr-1" />
                                  ) : meta?.source_id === "lovstudio" ? (
                                    <HeartFilledIcon className="w-3 h-3 inline mr-1" />
                                  ) : (
                                    <GlobeIcon className="w-3 h-3 inline mr-1" />
                                  )}
                                  {meta?.source_name}
                                </span>
                              )}
                            </div>
                            {skill.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{skill.description}</p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {filtered.length === 0 && !search && (
                <EmptyState
                  icon={TargetIcon}
                  message="No skills installed"
                  hint="Browse marketplace to install skills"
                />
              )}

              {filtered.length === 0 && search && (
                <p className="text-muted-foreground text-sm">No skills match "{search}"</p>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <MarketplaceContent
            category="skills"
            onSelectTemplate={onMarketplaceSelect}
          />
        </TabsContent>
      </Tabs>
    </ConfigPage>
  );
}

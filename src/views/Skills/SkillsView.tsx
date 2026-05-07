import { useMemo, useState, type ComponentType } from "react";
import { invoke } from "@/lib/tauri";
import {
  ArrowUpRight,
  BookOpen,
  Compass,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Gauge,
  MoreHorizontal,
  PackageCheck,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { LocalSkill, TemplateComponent, TemplatesCatalog } from "../../types";
import {
  LoadingState,
  EmptyState,
  ConfigPage,
} from "../../components/config";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { MarketplaceContent } from "../Marketplace";
import { useInvokeQuery, useQueryClient } from "../../hooks";
import { useI18n } from "@/i18n";
import {
  getSkillMarketplaceMeta,
  isMarketplaceLinkedSkill,
  skillToTemplate,
} from "./skillTemplates";

const ALL_FILTER = "all";
const ALL_VENDOR_FILTER = "all-vendors";
const MARKETPLACE_FILTER = "marketplace-linked";
const LOCAL_FILTER = "local";
const NEEDS_DESCRIPTION_FILTER = "needs-description";
const DISCOVERY_TOKEN_ESTIMATE = 100;
const SKILL_INSTRUCTION_TOKEN_BUDGET = 5000;

interface SkillsViewProps {
  onSelectTemplate: (template: TemplateComponent, localPath: string) => void;
  onMarketplaceSelect: (template: TemplateComponent) => void;
}

interface SourceFilter {
  id: string;
  label: string;
  count: number;
}

interface VendorFilter {
  id: string;
  label: string;
  count: number;
}

interface SkillTokenMetrics {
  discoveryTokens: number;
  instructionTokens: number;
  lineCount: number;
  status: "lean" | "near" | "over" | "long";
  statusLabel: string;
}

type SkillSortKey = "name" | "vendor" | "installed" | "discovery" | "triggered" | "lines" | "status";
type SortDir = "asc" | "desc";

function sourcePriority(sourceId?: string | null): number {
  const priorityMap: Record<string, number> = {
    anthropic: 1,
    lovstudio: 2,
    "lovstudio-plugins": 3,
    community: 4,
    local: 20,
  };

  return priorityMap[sourceId ?? "local"] ?? 10;
}

function formatSourceId(sourceId?: string | null): string {
  if (!sourceId) return "Marketplace";
  return sourceId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getSkillSourceId(skill: LocalSkill): string {
  const meta = getSkillMarketplaceMeta(skill);
  return isMarketplaceLinkedSkill(skill) ? meta?.source_id ?? LOCAL_FILTER : LOCAL_FILTER;
}

function getSkillSourceLabel(skill: LocalSkill): string {
  const meta = getSkillMarketplaceMeta(skill);

  if (!isMarketplaceLinkedSkill(skill)) {
    return "Local";
  }

  return meta?.source_name ?? formatSourceId(meta?.source_id);
}

function formatHomepageVendor(homepage?: string | null): string | null {
  if (!homepage) return null;

  try {
    const hostname = new URL(homepage).hostname.replace(/^www\./, "");
    const brand = hostname.split(".").filter(Boolean)[0];
    if (!brand) return hostname;
    return brand.charAt(0).toUpperCase() + brand.slice(1);
  } catch {
    return null;
  }
}

function getSkillVendor(skill: LocalSkill): string {
  const meta = getSkillMarketplaceMeta(skill);
  return (
    meta?.vendor ??
    meta?.source_name ??
    meta?.author ??
    formatHomepageVendor(meta?.homepage) ??
    getSkillSourceLabel(skill)
  );
}

function getVendorFilterId(vendor: string): string {
  return `vendor:${vendor.trim().toLowerCase()}`;
}

function getSkillAuthor(skill: LocalSkill): string | null {
  return getSkillMarketplaceMeta(skill)?.author ?? null;
}

function getTemplateSourceLabel(template: TemplateComponent): string {
  return template.source_name ?? formatSourceId(template.source_id);
}

function formatSkillPath(path: string): string {
  const match = path.match(/\/(\.agent|\.agents|\.claude)\/skills\/(.+)\/SKILL\.md$/);
  if (match) return `~/${match[1]}/skills/${match[2]}`;
  return path.replace(/\/SKILL\.md$/, "");
}

function getSkillBody(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\s*([\s\S]*)$/);
  return match ? match[1] : content;
}

function estimateTokens(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return 0;

  const cjkCount = normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const wordCount = normalized.match(/[A-Za-z0-9_]+(?:[-'][A-Za-z0-9_]+)*/g)?.length ?? 0;
  const structuralChars = normalized
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/g, "")
    .replace(/[A-Za-z0-9_]+(?:[-'][A-Za-z0-9_]+)*/g, "").length;

  return Math.max(1, Math.ceil(cjkCount + wordCount * 1.3 + structuralChars / 4));
}

function getSkillTokenMetrics(skill: LocalSkill): SkillTokenMetrics {
  const body = getSkillBody(skill.content);
  const instructionTokens = estimateTokens(body);
  const lineCount = body.split(/\r?\n/).filter((line) => line.trim().length > 0).length;

  if (instructionTokens > SKILL_INSTRUCTION_TOKEN_BUDGET) {
    return {
      discoveryTokens: DISCOVERY_TOKEN_ESTIMATE,
      instructionTokens,
      lineCount,
      status: "over",
      statusLabel: ">5k",
    };
  }

  if (instructionTokens > SKILL_INSTRUCTION_TOKEN_BUDGET * 0.8) {
    return {
      discoveryTokens: DISCOVERY_TOKEN_ESTIMATE,
      instructionTokens,
      lineCount,
      status: "near",
      statusLabel: "Near 5k",
    };
  }

  if (lineCount > 500) {
    return {
      discoveryTokens: DISCOVERY_TOKEN_ESTIMATE,
      instructionTokens,
      lineCount,
      status: "long",
      statusLabel: "Long file",
    };
  }

  return {
    discoveryTokens: DISCOVERY_TOKEN_ESTIMATE,
    instructionTokens,
    lineCount,
    status: "lean",
    statusLabel: "Lean",
  };
}

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  }

  return String(count);
}

function getSkillInstalledAt(skill: LocalSkill): number | null {
  return skill.installed_at ?? skill.modified_at ?? null;
}

function formatInstallTime(value: number | null): string {
  if (!value) return "Unknown";

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function getStatusRank(status: SkillTokenMetrics["status"]): number {
  const ranks: Record<SkillTokenMetrics["status"], number> = {
    over: 4,
    near: 3,
    long: 2,
    lean: 1,
  };

  return ranks[status];
}

function matchesSearch(values: Array<string | null | undefined>, query: string): boolean {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}

function matchesSkillSearch(skill: LocalSkill, query: string): boolean {
  const meta = getSkillMarketplaceMeta(skill);

  return matchesSearch(
    [
      skill.name,
      skill.description,
      skill.path,
      skill.home_label,
      skill.home_path,
      getSkillSourceLabel(skill),
      getSkillVendor(skill),
      meta?.author,
      meta?.vendor,
      meta?.homepage,
      meta?.source_id,
      meta?.source_name,
    ],
    query
  );
}

function matchesTemplateSearch(template: TemplateComponent, query: string): boolean {
  return matchesSearch(
    [
      template.name,
      template.description,
      template.category,
      template.plugin_name,
      template.source_id,
      template.source_name,
      template.author,
    ],
    query
  );
}

function sortTemplates(a: TemplateComponent, b: TemplateComponent): number {
  const priorityDiff = sourcePriority(a.source_id) - sourcePriority(b.source_id);
  if (priorityDiff !== 0) return priorityDiff;

  const downloadsDiff = (b.downloads ?? 0) - (a.downloads ?? 0);
  if (downloadsDiff !== 0) return downloadsDiff;

  return a.name.localeCompare(b.name);
}

function getBestTemplateForSkill(
  skill: LocalSkill,
  byPath: Map<string, TemplateComponent>,
  byName: Map<string, TemplateComponent>
): TemplateComponent | undefined {
  const meta = getSkillMarketplaceMeta(skill);

  if (meta?.template_path) {
    const byTemplatePath = byPath.get(meta.template_path);
    if (byTemplatePath) return byTemplatePath;
  }

  return byName.get(skill.name.toLowerCase());
}

export function SkillsView({ onSelectTemplate, onMarketplaceSelect }: SkillsViewProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: skills = [], isLoading } = useInvokeQuery<LocalSkill[]>(["skills"], "list_local_skills");
  const { data: catalog, isLoading: catalogLoading } = useInvokeQuery<TemplatesCatalog>(
    ["templatesCatalog"],
    "get_templates_catalog"
  );
  const [activeTab, setActiveTab] = useState("installed");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState(ALL_FILTER);
  const [vendorFilter, setVendorFilter] = useState(ALL_VENDOR_FILTER);
  const [sortKey, setSortKey] = useState<SkillSortKey>("triggered");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [installingName, setInstallingName] = useState<string | null>(null);
  const [uninstallingName, setUninstallingName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const marketplaceTemplates = catalog?.skills ?? [];
  const query = search.trim().toLowerCase();
  const skillHomeLabels = useMemo(() => {
    return Array.from(
      new Set(skills.map((skill) => skill.home_label).filter(Boolean))
    ) as string[];
  }, [skills]);

  const marketplaceLinkedCount = useMemo(
    () => skills.filter(isMarketplaceLinkedSkill).length,
    [skills]
  );
  const localCount = skills.length - marketplaceLinkedCount;
  const missingDescriptionCount = useMemo(
    () => skills.filter((skill) => !skill.description?.trim()).length,
    [skills]
  );
  const tokenStats = useMemo(() => {
    const metrics = skills.map(getSkillTokenMetrics);

    return {
      discoveryTokens: skills.length * DISCOVERY_TOKEN_ESTIMATE,
      overBudgetCount: metrics.filter((metric) => metric.status === "over").length,
      nearBudgetCount: metrics.filter((metric) => metric.status === "near").length,
    };
  }, [skills]);

  const marketplaceIndexes = useMemo(() => {
    const byName = new Map<string, TemplateComponent>();
    const byPath = new Map<string, TemplateComponent>();

    [...marketplaceTemplates].sort(sortTemplates).forEach((template) => {
      byPath.set(template.path, template);
      const key = template.name.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, template);
      }
    });

    return { byName, byPath };
  }, [marketplaceTemplates]);

  const filterOptions = useMemo<SourceFilter[]>(() => {
    const sourceCounts = new Map<string, SourceFilter>();

    for (const skill of skills) {
      if (!isMarketplaceLinkedSkill(skill)) continue;

      const id = getSkillSourceId(skill);
      const current = sourceCounts.get(id);
      sourceCounts.set(id, {
        id,
        label: getSkillSourceLabel(skill),
        count: (current?.count ?? 0) + 1,
      });
    }

    const baseFilters: SourceFilter[] = [
      { id: ALL_FILTER, label: t("common.all"), count: skills.length },
      { id: MARKETPLACE_FILTER, label: t("common.marketplace"), count: marketplaceLinkedCount },
      { id: LOCAL_FILTER, label: t("common.local"), count: localCount },
    ];

    if (missingDescriptionCount > 0) {
      baseFilters.push({
        id: NEEDS_DESCRIPTION_FILTER,
        label: t("skills.needsDescription"),
        count: missingDescriptionCount,
      });
    }

    return [
      ...baseFilters.filter((filter) => filter.id === ALL_FILTER || filter.count > 0),
      ...Array.from(sourceCounts.values()).sort((a, b) => {
        const priorityDiff = sourcePriority(a.id) - sourcePriority(b.id);
        if (priorityDiff !== 0) return priorityDiff;
        return a.label.localeCompare(b.label);
      }),
    ];
  }, [localCount, marketplaceLinkedCount, missingDescriptionCount, skills, t]);

  const vendorOptions = useMemo<VendorFilter[]>(() => {
    const vendorCounts = new Map<string, VendorFilter>();

    for (const skill of skills) {
      const label = getSkillVendor(skill);
      const id = getVendorFilterId(label);
      const current = vendorCounts.get(id);
      vendorCounts.set(id, {
        id,
        label: current?.label ?? label,
        count: (current?.count ?? 0) + 1,
      });
    }

    return [
      { id: ALL_VENDOR_FILTER, label: t("skills.allVendors"), count: skills.length },
      ...Array.from(vendorCounts.values()).sort((a, b) => {
        const countDiff = b.count - a.count;
        if (countDiff !== 0) return countDiff;
        return a.label.localeCompare(b.label);
      }),
    ];
  }, [skills, t]);

  const filteredSkills = useMemo(() => {
    return skills
      .filter((skill) => {
        if (!matchesSkillSearch(skill, query)) return false;

        const matchesSource =
          sourceFilter === ALL_FILTER ||
          (sourceFilter === MARKETPLACE_FILTER && isMarketplaceLinkedSkill(skill)) ||
          (sourceFilter === LOCAL_FILTER && !isMarketplaceLinkedSkill(skill)) ||
          (sourceFilter === NEEDS_DESCRIPTION_FILTER && !skill.description?.trim()) ||
          getSkillSourceId(skill) === sourceFilter;

        if (!matchesSource) return false;
        if (vendorFilter === ALL_VENDOR_FILTER) return true;

        return getVendorFilterId(getSkillVendor(skill)) === vendorFilter;
      });
  }, [query, skills, sourceFilter, vendorFilter]);

  const sortedSkills = useMemo(() => {
    const compareText = (a: string, b: string) => a.localeCompare(b);

    return [...filteredSkills].sort((a, b) => {
      const aMetrics = getSkillTokenMetrics(a);
      const bMetrics = getSkillTokenMetrics(b);
      let result = 0;

      switch (sortKey) {
        case "name":
          result = compareText(a.name, b.name);
          break;
        case "vendor":
          result = compareText(getSkillVendor(a), getSkillVendor(b));
          break;
        case "installed":
          result = (getSkillInstalledAt(a) ?? 0) - (getSkillInstalledAt(b) ?? 0);
          break;
        case "discovery":
          result = aMetrics.discoveryTokens - bMetrics.discoveryTokens;
          break;
        case "triggered":
          result = aMetrics.instructionTokens - bMetrics.instructionTokens;
          break;
        case "lines":
          result = aMetrics.lineCount - bMetrics.lineCount;
          break;
        case "status":
          result = getStatusRank(aMetrics.status) - getStatusRank(bMetrics.status);
          break;
      }

      if (result === 0) {
        result = compareText(a.name, b.name);
      }

      return sortDir === "asc" ? result : -result;
    });
  }, [filteredSkills, sortDir, sortKey]);

  const marketplaceSuggestions = useMemo(() => {
    const installedNames = new Set(skills.map((skill) => skill.name.toLowerCase()));

    return [...marketplaceTemplates]
      .filter((template) => !installedNames.has(template.name.toLowerCase()))
      .filter((template) => (query ? matchesTemplateSearch(template, query) : true))
      .sort(sortTemplates)
      .slice(0, query ? 8 : 5);
  }, [marketplaceTemplates, query, skills]);

  const sourceBreakdown = useMemo(() => {
    return filterOptions.filter(
      (filter) =>
        filter.id !== ALL_FILTER &&
        filter.id !== MARKETPLACE_FILTER &&
        filter.id !== NEEDS_DESCRIPTION_FILTER
    );
  }, [filterOptions]);

  const handleQuickInstall = async (template: TemplateComponent) => {
    if (!template.content) {
      setActionError(`No installable content found for ${template.name}.`);
      return;
    }

    setInstallingName(template.name);
    setActionError(null);

    try {
      await invoke("install_skill_template", {
        name: template.name,
        content: template.content,
        source_id: template.source_id,
        source_name: template.source_name,
        author: template.author,
        downloads: template.downloads,
        template_path: template.path,
      });
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
    } catch (e) {
      setActionError(String(e));
    } finally {
      setInstallingName(null);
    }
  };

  const handleUninstallSkill = async (skill: LocalSkill) => {
    if (!window.confirm(t("skills.confirmUninstall", { name: skill.name }))) return;

    setUninstallingName(skill.name);
    setActionError(null);

    try {
      await invoke("uninstall_skill", { name: skill.name });
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
    } catch (e) {
      setActionError(String(e));
    } finally {
      setUninstallingName(null);
    }
  };

  const handleOpenInEditor = (path: string) => invoke("open_in_editor", { path });
  const handleRevealPath = (path: string) => invoke("reveal_path", { path });
  const handleCopyPath = (path: string) => invoke("copy_to_clipboard", { text: path });
  const handleSort = (key: SkillSortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDir(key === "name" || key === "vendor" ? "asc" : "desc");
  };

  return (
    <ConfigPage>
      <header className="mb-6 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="font-serif text-3xl font-semibold text-foreground">{t("skills.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("skills.installedAcross", {
                count: skills.length,
                homes: skillHomeLabels.length > 0 ? skillHomeLabels.join(", ") : t("skills.agentSkillHomes"),
              })}
            </p>
          </div>
          <Button onClick={() => setActiveTab("marketplace")} className="gap-2 rounded-lg">
            <Compass className="size-4" />
            {t("skills.browseMarketplace")}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            icon={PackageCheck}
            label={t("common.installed")}
            value={skills.length}
            detail={t("skills.skillHomes", { count: skillHomeLabels.length || 0 })}
          />
          <MetricCard
            icon={Compass}
            label={t("common.marketplace")}
            value={marketplaceTemplates.length}
            detail={t("skills.localSkills", { count: localCount })}
          />
          <MetricCard
            icon={Gauge}
            label={t("skills.tokenBudget")}
            value={tokenStats.overBudgetCount}
            detail={t("skills.discoveryTokens", { count: formatTokenCount(tokenStats.discoveryTokens) })}
          />
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="bg-card-alt border border-border">
            <TabsTrigger value="installed">{t("common.installed")}</TabsTrigger>
            <TabsTrigger value="marketplace">{t("common.marketplace")}</TabsTrigger>
          </TabsList>
          {activeTab === "installed" && (
            <p className="text-xs text-muted-foreground">
              {t("skills.visible", { count: sortedSkills.length })}
              {vendorFilter !== ALL_VENDOR_FILTER && ` · ${vendorOptions.find((filter) => filter.id === vendorFilter)?.label ?? t("skills.vendor")}`}
            </p>
          )}
        </div>

        <TabsContent value="installed" className="mt-0">
          {isLoading ? (
            <LoadingState message={t("skills.loading")} />
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <main className="min-w-0 space-y-4">
                <div className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t("skills.searchPlaceholder")}
                        className="h-10 rounded-lg bg-background pl-9"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Filter className="size-4" />
                      <span>
                        {filterOptions.find((filter) => filter.id === sourceFilter)?.label ?? t("skills.filtered")}
                        {vendorFilter !== ALL_VENDOR_FILTER && ` · ${vendorOptions.find((filter) => filter.id === vendorFilter)?.label ?? t("skills.vendor")}`}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                    {t("skills.tokenEstimateHelp", {
                      discovery: DISCOVERY_TOKEN_ESTIMATE,
                      budget: formatTokenCount(SKILL_INSTRUCTION_TOKEN_BUDGET),
                    })}
                    {missingDescriptionCount > 0 && ` ${t("skills.missingDescriptions", { count: missingDescriptionCount })}`}
                    {tokenStats.nearBudgetCount > 0 && ` ${t("skills.nearBudget", { count: tokenStats.nearBudgetCount })}`}
                  </div>

                  <div className="mt-3 space-y-3 border-t border-border pt-3">
                    <FilterChipGroup
                      label={t("skills.sources")}
                      options={filterOptions}
                      activeId={sourceFilter}
                      onSelect={setSourceFilter}
                    />
                    <FilterChipGroup
                      label={t("skills.vendors")}
                      options={vendorOptions}
                      activeId={vendorFilter}
                      onSelect={setVendorFilter}
                    />
                  </div>
                </div>

                {actionError && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {actionError}
                  </div>
                )}

                {sortedSkills.length > 0 && (
                  <SkillTable
                    skills={sortedSkills}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    marketplaceIndexes={marketplaceIndexes}
                    uninstallingName={uninstallingName}
                    onSort={handleSort}
                    onSelectTemplate={onSelectTemplate}
                    onMarketplaceSelect={onMarketplaceSelect}
                    onOpenInEditor={handleOpenInEditor}
                    onRevealPath={handleRevealPath}
                    onCopyPath={handleCopyPath}
                    onUninstall={handleUninstallSkill}
                  />
                )}

                {sortedSkills.length === 0 && !search && (
                  <EmptyState
                    icon={BookOpen}
                    message={t("skills.noInstalled")}
                    hint={t("skills.installHint")}
                  />
                )}

                {sortedSkills.length === 0 && search && (
                  <EmptyState
                    icon={Search}
                    message={t("skills.noMatch", { search })}
                    hint={t("skills.tryAnotherKeyword")}
                  />
                )}
              </main>

              <aside className="space-y-4">
                <MarketplaceAssistPanel
                  templates={marketplaceSuggestions}
                  isLoading={catalogLoading}
                  search={search}
                  installingName={installingName}
                  onPreview={onMarketplaceSelect}
                  onQuickInstall={handleQuickInstall}
                  onBrowseAll={() => setActiveTab("marketplace")}
                />

                <SourceBreakdownPanel sources={sourceBreakdown} />
              </aside>
            </div>
          )}
        </TabsContent>

        <TabsContent value="marketplace" className="mt-0">
          <MarketplaceContent
            category="skills"
            onSelectTemplate={onMarketplaceSelect}
          />
        </TabsContent>
      </Tabs>
    </ConfigPage>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 font-serif text-3xl font-semibold text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <Icon className="size-4" />
        </div>
      </div>
    </div>
  );
}

function FilterChipGroup({
  label,
  options,
  activeId,
  onSelect,
}: {
  label: string;
  options: Array<{ id: string; label: string; count: number }>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-[88px_minmax(0,1fr)] md:items-start">
      <p className="pt-1 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => onSelect(filter.id)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              activeId === filter.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            <span>{filter.label}</span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {filter.count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SkillTable({
  skills,
  sortKey,
  sortDir,
  marketplaceIndexes,
  uninstallingName,
  onSort,
  onSelectTemplate,
  onMarketplaceSelect,
  onOpenInEditor,
  onRevealPath,
  onCopyPath,
  onUninstall,
}: {
  skills: LocalSkill[];
  sortKey: SkillSortKey;
  sortDir: SortDir;
  marketplaceIndexes: {
    byName: Map<string, TemplateComponent>;
    byPath: Map<string, TemplateComponent>;
  };
  uninstallingName: string | null;
  onSort: (key: SkillSortKey) => void;
  onSelectTemplate: (template: TemplateComponent, localPath: string) => void;
  onMarketplaceSelect: (template: TemplateComponent) => void;
  onOpenInEditor: (path: string) => void;
  onRevealPath: (path: string) => void;
  onCopyPath: (path: string) => void;
  onUninstall: (skill: LocalSkill) => void;
}) {
  const { t } = useI18n();

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="hidden grid-cols-[56px_minmax(240px,1fr)_140px_118px_92px_110px_72px_92px_80px] gap-3 border-b border-border bg-muted/50 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground lg:grid">
        <span>{t("skills.rank")}</span>
        <SortHeader label={t("skills.title")} sortKey="name" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <SortHeader label={t("skills.vendor")} sortKey="vendor" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <SortHeader label={t("common.installed")} sortKey="installed" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <SortHeader label={t("skills.discovery")} sortKey="discovery" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <SortHeader label={t("skills.triggered")} sortKey="triggered" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <SortHeader label={t("skills.lines")} sortKey="lines" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <SortHeader label={t("common.status")} sortKey="status" activeKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <span className="text-right">{t("skills.actions")}</span>
      </div>

      {skills.map((skill, index) => (
        <SkillRow
          key={skill.path}
          rank={index + 1}
          skill={skill}
          marketplaceTemplate={getBestTemplateForSkill(
            skill,
            marketplaceIndexes.byPath,
            marketplaceIndexes.byName
          )}
          uninstalling={uninstallingName === skill.name}
          onSelect={() => onSelectTemplate(skillToTemplate(skill), skill.path)}
          onMarketplaceSelect={onMarketplaceSelect}
          onOpenInEditor={onOpenInEditor}
          onRevealPath={onRevealPath}
          onCopyPath={onCopyPath}
          onUninstall={onUninstall}
        />
      ))}
    </section>
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  sortDir,
  onSort,
}: {
  label: string;
  sortKey: SkillSortKey;
  activeKey: SkillSortKey;
  sortDir: SortDir;
  onSort: (key: SkillSortKey) => void;
}) {
  const isActive = sortKey === activeKey;

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`text-left transition-colors hover:text-foreground ${isActive ? "text-primary" : ""}`}
    >
      {label}
      {isActive && <span className="ml-1 lowercase">{sortDir}</span>}
    </button>
  );
}

function SkillRow({
  rank,
  skill,
  marketplaceTemplate,
  uninstalling,
  onSelect,
  onMarketplaceSelect,
  onOpenInEditor,
  onRevealPath,
  onCopyPath,
  onUninstall,
}: {
  rank: number;
  skill: LocalSkill;
  marketplaceTemplate?: TemplateComponent;
  uninstalling: boolean;
  onSelect: () => void;
  onMarketplaceSelect: (template: TemplateComponent) => void;
  onOpenInEditor: (path: string) => void;
  onRevealPath: (path: string) => void;
  onCopyPath: (path: string) => void;
  onUninstall: (skill: LocalSkill) => void;
}) {
  const { t, translate } = useI18n();
  const meta = getSkillMarketplaceMeta(skill);
  const sourceLabel = getSkillSourceLabel(skill);
  const vendor = getSkillVendor(skill);
  const author = getSkillAuthor(skill);
  const homeLabel = skill.home_label ?? null;
  const installedAt = getSkillInstalledAt(skill);
  const tokenMetrics = getSkillTokenMetrics(skill);
  const statusClass =
    tokenMetrics.status === "over"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tokenMetrics.status === "near" || tokenMetrics.status === "long"
        ? "border-primary/30 bg-primary/10 text-primary"
        : "border-border bg-secondary text-muted-foreground";

  return (
    <div className="grid gap-3 border-b border-border p-3 transition-colors last:border-b-0 hover:bg-accent/50 lg:grid-cols-[56px_minmax(240px,1fr)_140px_118px_92px_110px_72px_92px_80px] lg:items-start">
      <div className="hidden font-mono text-sm text-muted-foreground lg:block">
        #{rank}
      </div>

      <button onClick={onSelect} className="min-w-0 text-left">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground lg:hidden">#{rank}</span>
          <h3 className="truncate font-medium text-foreground">{skill.name}</h3>
          {homeLabel && (
            <span className="inline-flex shrink-0 items-center rounded-lg border border-border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {homeLabel}
            </span>
          )}
          {meta?.downloads != null && (
            <span className="text-xs text-muted-foreground">
              {t("skills.downloads", { count: meta.downloads })}
            </span>
          )}
        </div>

        {skill.description ? (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{skill.description}</p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{t("skills.noDescription")}</p>
        )}

        <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
          {formatSkillPath(skill.path)}
        </p>
      </button>

      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground lg:hidden">{t("skills.vendor")}</p>
        <p className="truncate text-sm text-foreground" title={vendor}>{vendor}</p>
        {author && author !== vendor && (
          <p className="truncate text-xs text-muted-foreground" title={author}>{author}</p>
        )}
        {!author && vendor !== sourceLabel && (
          <p className="truncate text-xs text-muted-foreground" title={sourceLabel}>{sourceLabel}</p>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground lg:hidden">{t("common.installed")}</p>
        <p className="font-mono text-sm text-foreground" title={installedAt ? new Date(installedAt).toLocaleString() : undefined}>
          {formatInstallTime(installedAt)}
        </p>
      </div>

      <TokenCell
        label={t("skills.discovery")}
        value={`~${formatTokenCount(tokenMetrics.discoveryTokens)}`}
        title={t("skills.metadataBudgetTitle")}
      />
      <TokenCell
        label={t("skills.triggered")}
        value={`~${formatTokenCount(tokenMetrics.instructionTokens)}`}
        title={t("skills.bodyTokensTitle")}
      />
      <TokenCell label={t("skills.lines")} value={String(tokenMetrics.lineCount)} />
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground lg:hidden">{t("common.status")}</p>
        <span className={`inline-flex rounded-lg border px-2 py-1 text-xs ${statusClass}`}>
          {translate(tokenMetrics.statusLabel)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1 lg:justify-end">
        {marketplaceTemplate && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            title={t("skills.openMarketplaceVersion")}
            aria-label={t("skills.openMarketplaceVersion")}
            onClick={() => onMarketplaceSelect(marketplaceTemplate)}
          >
            <ArrowUpRight className="size-4" />
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              title={t("skills.skillActions")}
              aria-label={t("skills.skillActions")}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onOpenInEditor(skill.path)}>
              <FileText className="size-4" />
              {t("common.openInEditor")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRevealPath(skill.path)}>
              <ExternalLink className="size-4" />
              {t("fileViewer.revealInFinder")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCopyPath(skill.path)}>
              <Copy className="size-4" />
              {t("common.copyPath")}
            </DropdownMenuItem>
            {marketplaceTemplate && (
              <DropdownMenuItem onClick={() => onMarketplaceSelect(marketplaceTemplate)}>
                <Compass className="size-4" />
                {t("skills.marketplaceVersion")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onUninstall(skill)}
              disabled={uninstalling}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-4" />
              {uninstalling ? t("skills.uninstalling") : t("skills.uninstall")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function TokenCell({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div title={title}>
      <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground lg:hidden">{label}</p>
      <p className="font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

function MarketplaceAssistPanel({
  templates,
  isLoading,
  search,
  installingName,
  onPreview,
  onQuickInstall,
  onBrowseAll,
}: {
  templates: TemplateComponent[];
  isLoading: boolean;
  search: string;
  installingName: string | null;
  onPreview: (template: TemplateComponent) => void;
  onQuickInstall: (template: TemplateComponent) => void;
  onBrowseAll: () => void;
}) {
  const { t } = useI18n();

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground">
            {search ? t("skills.marketplaceMatches") : t("skills.suggestedSkills")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {search ? t("skills.notInstalledYet") : t("skills.availableToInstall")}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2 rounded-lg"
          onClick={onBrowseAll}
        >
          <Compass className="size-4" />
          {t("skills.browse")}
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {isLoading && (
          <p className="text-sm text-muted-foreground">{t("skills.loadingMarketplace")}</p>
        )}

        {!isLoading && templates.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {search ? t("skills.noMarketplaceMatches") : t("skills.noMarketplaceAvailable")}
          </p>
        )}

        {!isLoading && templates.map((template) => (
          <MarketplaceSuggestion
            key={`${template.source_id}-${template.path}`}
            template={template}
            installing={installingName === template.name}
            onPreview={onPreview}
            onQuickInstall={onQuickInstall}
          />
        ))}
      </div>
    </section>
  );
}

function MarketplaceSuggestion({
  template,
  installing,
  onPreview,
  onQuickInstall,
}: {
  template: TemplateComponent;
  installing: boolean;
  onPreview: (template: TemplateComponent) => void;
  onQuickInstall: (template: TemplateComponent) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <button onClick={() => onPreview(template)} className="w-full text-left">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-primary" />
          <p className="truncate font-medium text-foreground">{template.name}</p>
        </div>
        {template.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{template.description}</p>
        )}
      </button>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="truncate text-xs text-muted-foreground">
          {getTemplateSourceLabel(template)}
          {template.downloads != null ? ` · ${t("skills.downloads", { count: template.downloads })}` : ""}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={installing || !template.content}
          className="h-8 shrink-0 gap-1.5 rounded-lg px-2.5"
          onClick={() => onQuickInstall(template)}
        >
          <Download className="size-3.5" />
          {installing ? t("skills.installing") : t("common.install")}
        </Button>
      </div>
    </div>
  );
}

function SourceBreakdownPanel({ sources }: { sources: SourceFilter[] }) {
  const { t } = useI18n();

  if (sources.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Filter className="size-4 text-primary" />
        <h2 className="font-serif text-lg font-semibold text-foreground">{t("skills.sources")}</h2>
      </div>
      <div className="space-y-2">
        {sources.map((source) => (
          <div key={source.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-muted-foreground">{source.label}</span>
            <span className="rounded-lg bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {source.count}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

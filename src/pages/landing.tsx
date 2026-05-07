import { useEffect, useMemo } from "react";
import {
  Archive,
  ArrowRight,
  BookOpen,
  ChevronRight,
  Code2,
  Compass,
  Crosshair,
  Download,
  ExternalLink,
  FileText,
  Flag,
  Github,
  GitPullRequest,
  MapPinned,
  Monitor,
  ScanEye,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Telescope,
  type LucideIcon,
} from "lucide-react";
import { useI18n, type Language } from "@/i18n";

const logoUrl = new URL("../../assets/logo.svg", import.meta.url).href;
const coverUrl = new URL("../../docs/images/cover.png", import.meta.url).href;
const galleryUrl = new URL("../../docs/assets/gallery.png", import.meta.url).href;

const githubUrl = "https://github.com/lovstudio/lovcode";
const releasesUrl = `${githubUrl}/releases`;
const docsUrl = `${githubUrl}/tree/main/docs`;
const readmeUrl = `${githubUrl}#readme`;
const changelogUrl = `${githubUrl}/blob/main/CHANGELOG.md`;

type Localized = Record<Language, string>;

interface CampaignStep {
  motto: Localized;
  latin: string;
  icon: LucideIcon;
  title: Localized;
  body: Localized;
}

interface Feature {
  icon: LucideIcon;
  title: Localized;
  body: Localized;
}

interface FieldSignal {
  label: Localized;
  value: Localized;
}

const campaignSteps: CampaignStep[] = [
  {
    motto: { en: "I came", zh: "我来" },
    latin: "Veni",
    icon: Compass,
    title: { en: "Enter the project field", zh: "进入项目现场" },
    body: {
      en: "Pick the repository, runtime, setup script, and agent channel before the work begins.",
      zh: "在任务开始前选好仓库、运行时、启动脚本和 Agent 通道。",
    },
  },
  {
    motto: { en: "I saw", zh: "我见" },
    latin: "Vidi",
    icon: ScanEye,
    title: { en: "Read the whole situation", zh: "看清完整局势" },
    body: {
      en: "Keep files, terminal output, previous sessions, tools, commands, and references in sight.",
      zh: "让文件、终端输出、历史会话、工具调用、命令和参考资料尽收眼底。",
    },
  },
  {
    motto: { en: "I conquered", zh: "我征服" },
    latin: "Vici",
    icon: Flag,
    title: { en: "Finish with a trace", zh: "带着记录完成" },
    body: {
      en: "Resume the exact session, hand off context, and preserve the route that shipped the work.",
      zh: "回到准确会话、交接上下文，并保留拿下任务的路径。",
    },
  },
];

const fieldSignals: FieldSignal[] = [
  { value: { en: "Project-first", zh: "项目优先" }, label: { en: "cwd, agents, terminals", zh: "目录、Agent、终端" } },
  { value: { en: "Traceable", zh: "有迹可循" }, label: { en: "history, tools, linked files", zh: "历史、工具、关联文件" } },
  { value: { en: "Repeatable", zh: "可复用" }, label: { en: "commands, MCP, skills, hooks", zh: "Commands、MCP、Skills、Hooks" } },
];

const featureCards: Feature[] = [
  {
    icon: MapPinned,
    title: { en: "Project map, not terminal sprawl", zh: "项目地图，而不是终端散落" },
    body: {
      en: "Start Claude Code, Codex, terminals, or plain chat from the repository where the task belongs.",
      zh: "从任务所在仓库启动 Claude Code、Codex、终端或通用对话。",
    },
  },
  {
    icon: Telescope,
    title: { en: "See what the agents changed", zh: "看清 Agent 改了什么" },
    body: {
      en: "Search sessions, inspect structured tool calls, preview linked paths, and reopen the thread that matters.",
      zh: "搜索会话、查看结构化工具调用、预览路径，并重新打开关键线程。",
    },
  },
  {
    icon: Crosshair,
    title: { en: "Aim repeatable tactics", zh: "瞄准可复用战术" },
    body: {
      en: "Commands, MCP servers, skills, hooks, output styles, MaaS providers, and scripts stay organized.",
      zh: "Commands、MCP、Skills、Hooks、Output styles、MaaS 和脚本集中管理。",
    },
  },
  {
    icon: Archive,
    title: { en: "Archive the winning route", zh: "归档拿下任务的路径" },
    body: {
      en: "Keep useful discoveries searchable after the session ends, then hand them to the next agent or teammate.",
      zh: "把有价值的发现留到会话结束后仍可检索，并交给下一个 Agent 或同事。",
    },
  },
];

const docCards: Feature[] = [
  {
    icon: Search,
    title: { en: "Search across sources", zh: "跨来源搜索" },
    body: {
      en: "Find material across bundled docs, GitHub sources, local vaults, and distilled Markdown.",
      zh: "跨内置文档、GitHub 来源、本地 vault 和沉淀 Markdown 查找内容。",
    },
  },
  {
    icon: FileText,
    title: { en: "Read like an archive", zh: "像档案一样阅读" },
    body: {
      en: "Use outlines, reading progress, code blocks, images, frontmatter, and resizable panes.",
      zh: "支持目录、阅读进度、代码块、图片、frontmatter 和可调整阅读栏。",
    },
  },
  {
    icon: GitPullRequest,
    title: { en: "Bring external records in", zh: "接入外部记录" },
    body: {
      en: "Add GitHub repositories and local knowledge folders without flattening the workflow.",
      zh: "接入 GitHub 仓库和本地知识目录，同时保留原有工作流。",
    },
  },
];

function pick(value: Localized, language: Language) {
  return value[language];
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function SectionMark({ label }: { label: string }) {
  return (
    <div className="mb-5 flex items-center gap-3 text-xs font-medium text-muted-foreground">
      <span className="h-px w-12 bg-border" />
      <span>{label}</span>
    </div>
  );
}

export default function LandingPage() {
  const { activeLanguage } = useI18n();

  useEffect(() => {
    window.dispatchEvent(new Event("app:ready"));
  }, []);

  const copy = useMemo(
    () => ({
      navProduct: activeLanguage === "zh" ? "产品" : "Product",
      navDocs: activeLanguage === "zh" ? "文档" : "Docs",
      navDownload: activeLanguage === "zh" ? "下载" : "Download",
      badge: activeLanguage === "zh" ? "给 Claude Code / Codex 重度用户的战役指挥桌" : "Campaign command table for Claude Code and Codex power users",
      headline: activeLanguage === "zh" ? "我来，我见，我征服。" : "I came, I saw, I conquered.",
      titleText: activeLanguage === "zh" ? "Lovcode - 我来，我见，我征服" : "Lovcode - I came, I saw, I conquered",
      originLine: activeLanguage === "zh" ? "Veni. Vidi. Vici. / 我来，我见，我征服。" : "Veni. Vidi. Vici.",
      subhead:
        activeLanguage === "zh"
          ? "Lovcode 把 AI 编码从一堆终端窗口，重排成一张本地战役桌：进入项目、看清上下文、指挥 Agent 交付结果。"
          : "Lovcode turns scattered AI coding terminals into a local campaign table: enter the project, see the context, and direct agents to ship.",
      primaryCta: activeLanguage === "zh" ? "下载 Lovcode" : "Download Lovcode",
      secondaryCta: activeLanguage === "zh" ? "查看源码" : "View source",
      docsCta: activeLanguage === "zh" ? "阅读档案" : "Read the archive",
      visualLabel: activeLanguage === "zh" ? "Lovcode 指挥桌" : "Lovcode command table",
      commandLedger: activeLanguage === "zh" ? "指挥账本" : "Command ledger",
      ledgerRows:
        activeLanguage === "zh"
          ? [
              ["现场", "本地项目、终端、Agent"],
              ["情报", "历史、文件、工具调用"],
              ["战术", "Commands、MCP、Skills"],
              ["结果", "接续、交接、复盘"],
            ]
          : [
              ["Field", "Projects, terminals, agents"],
              ["Intel", "History, files, tool calls"],
              ["Tactics", "Commands, MCP, skills"],
              ["Result", "Resume, hand off, review"],
            ],
      productSection: activeLanguage === "zh" ? "战场重构" : "Field Reconstruction",
      productTitle:
        activeLanguage === "zh"
          ? "AI 编码不是聊天，是指挥。"
          : "AI coding is not chat. It is command.",
      productBody:
        activeLanguage === "zh"
          ? "当多个 Agent、终端、模型和配置同时运转，开发者真正需要的是态势感。Lovcode 把项目现场、历史记录、执行工具和文档依据摆到同一张桌面上，让每一次推进都有上下文。"
          : "When agents, terminals, models, and configuration all run at once, developers need situational command. Lovcode places project field, session record, execution tools, and source material on the same table so every move has context.",
      doctrineSection: activeLanguage === "zh" ? "三幕工作流" : "Three-act Workflow",
      doctrineTitle: activeLanguage === "zh" ? "我来。我见。我征服。" : "Veni. Vidi. Vici.",
      doctrineBody:
        activeLanguage === "zh"
          ? "这不是装饰性的史诗口号，而是 Lovcode 的操作结构：抵达现场，读懂局势，留下可复盘的胜利路径。"
          : "This is not decorative epic language. It is Lovcode's operating structure: arrive at the field, read the situation, and preserve a winning route.",
      docsSection: activeLanguage === "zh" ? "战役档案" : "Campaign Archive",
      docsTitle:
        activeLanguage === "zh"
          ? "每次判断，都要有证据。"
          : "Every decision needs evidence.",
      docsBody:
        activeLanguage === "zh"
          ? "公开文档用于上手；安装后，App 内文档中心把 Claude Code、Codex、GitHub 仓库、本地 vault 和团队沉淀放进同一个阅读器。排查问题、交接上下文、复用经验时，资料始终在当前工作流旁边。"
          : "Public docs help you start. After installation, the in-app docs center brings Claude Code, Codex, GitHub repositories, local vaults, and distilled team notes into one reader, keeping evidence beside debugging, handoff, and reuse.",
      deploySection: activeLanguage === "zh" ? "部署指令" : "Deployment Order",
      deployTitle:
        activeLanguage === "zh"
          ? "部署 Lovcode，接管 AI 编码现场。"
          : "Deploy Lovcode and take command of the AI coding field.",
      deployBody:
        activeLanguage === "zh"
          ? "普通用户下载 release；开发者可以查看源码并本地运行。Lovcode 不是替你写代码的新模型，而是让你管理 AI 编码过程的桌面指挥系统。"
          : "Download a release as a user, or inspect and run the source locally. Lovcode is not another model that writes code for you; it is the desktop command system for managing AI coding work.",
      installCommand: "git clone --recursive https://github.com/lovstudio/lovcode.git\ncd lovcode\npnpm install\npnpm tauri dev",
      sourceRunTitle: activeLanguage === "zh" ? "源码运行" : "Run from source",
      changelogCta: activeLanguage === "zh" ? "更新记录" : "Changelog",
      footerBody:
        activeLanguage === "zh"
          ? "Release 下载、源码、文档和更新记录都在 GitHub。"
          : "Releases, source code, docs, and changelog are all available on GitHub.",
      auditLine:
        activeLanguage === "zh"
          ? "本地项目优先，公开源码可审计；记录可回看，交接有上下文。"
          : "Local-project first and open source; records stay readable, handoff keeps context.",
    }),
    [activeLanguage],
  );

  useEffect(() => {
    document.title = copy.titleText;
  }, [copy.titleText]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 lg:px-8">
          <a href="#/landing" className="flex items-center gap-3">
            <img src={logoUrl} alt="" className="h-9 w-9" />
            <span className="font-serif text-xl text-foreground">Lovcode</span>
          </a>

          <div className="hidden items-center gap-1 md:flex">
            <button
              type="button"
              onClick={() => scrollToSection("product")}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {copy.navProduct}
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("docs")}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {copy.navDocs}
            </button>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              GitHub
            </a>
          </div>

          <a
            href={releasesUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="mr-2 h-4 w-4" />
            {copy.navDownload}
          </a>
        </nav>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-center opacity-35" />
          <div className="absolute inset-0 bg-background/90" />
          <div className="absolute left-0 top-24 h-px w-full bg-border" />
          <div className="absolute bottom-24 left-0 h-px w-full bg-border" />
          <div className="absolute -left-40 top-1/2 h-px w-[56rem] rotate-45 bg-border" />
          <div className="absolute right-0 top-32 h-px w-[36rem] -rotate-12 bg-border" />

          <div className="relative mx-auto grid min-h-[82vh] max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[minmax(0,0.83fr)_minmax(440px,1.17fr)] lg:items-center lg:px-8">
            <div>
              <div className="mb-8 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {copy.badge}
              </div>

              <p className="mb-3 font-serif text-base text-primary">{copy.originLine}</p>
              <h1 className="max-w-4xl font-serif text-5xl leading-[0.96] text-foreground sm:text-6xl lg:text-7xl">
                {copy.headline}
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                {copy.subhead}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href={releasesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {copy.primaryCta}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-input bg-background px-6 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Github className="mr-2 h-4 w-4" />
                  {copy.secondaryCta}
                </a>
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <BookOpen className="mr-2 h-4 w-4" />
                  {copy.docsCta}
                </a>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {fieldSignals.map((signal) => (
                  <div key={pick(signal.value, activeLanguage)} className="border-l border-border pl-4">
                    <div className="font-serif text-xl text-foreground">{pick(signal.value, activeLanguage)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{pick(signal.label, activeLanguage)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative lg:pl-4">
              <div className="absolute -left-4 top-8 hidden h-44 w-24 border-l border-t border-border lg:block" />
              <figure className="relative overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-muted" />
                    <span className="h-2.5 w-2.5 rounded-full bg-muted" />
                    <span className="h-2.5 w-2.5 rounded-full bg-muted" />
                  </div>
                  <span className="text-xs text-muted-foreground">{copy.visualLabel}</span>
                </div>
                <img src={galleryUrl} alt={copy.visualLabel} className="w-full object-cover" />
              </figure>

              <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,0.58fr)_minmax(240px,0.42fr)]">
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <p className="text-sm leading-6 text-muted-foreground">{copy.auditLine}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                    <ScrollText className="h-4 w-4 text-primary" />
                    {copy.commandLedger}
                  </div>
                  <div className="space-y-2">
                    {copy.ledgerRows.map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 border-t border-border pt-2 text-xs">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="text-foreground">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="product" className="scroll-mt-16 border-b border-border bg-background px-5 py-20 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,0.74fr)_minmax(320px,0.46fr)] lg:items-end">
              <div>
                <SectionMark label={copy.productSection} />
                <h2 className="font-serif text-4xl leading-tight text-foreground md:text-5xl">{copy.productTitle}</h2>
                <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">{copy.productBody}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start gap-3 text-sm leading-6 text-foreground">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
                  <span>{copy.auditLine}</span>
                </div>
              </div>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {featureCards.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article key={pick(feature.title, activeLanguage)} className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-5 font-serif text-xl text-foreground">{pick(feature.title, activeLanguage)}</h3>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{pick(feature.body, activeLanguage)}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden border-b border-border bg-card-alt/50 px-5 py-20 lg:px-8">
          <div className="absolute left-0 top-1/2 hidden h-px w-full bg-border md:block" />
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <SectionMark label={copy.doctrineSection} />
              <h2 className="font-serif text-4xl leading-tight text-foreground md:text-5xl">{copy.doctrineTitle}</h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">{copy.doctrineBody}</p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {campaignSteps.map((step) => {
                const Icon = step.icon;
                return (
                  <article key={step.latin} className="relative rounded-xl border border-border bg-card p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-serif text-5xl text-primary/25">{step.latin}</p>
                        <h3 className="mt-4 font-serif text-2xl text-foreground">{pick(step.motto, activeLanguage)}</h3>
                      </div>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </span>
                    </div>
                    <h4 className="mt-6 text-sm font-medium text-foreground">{pick(step.title, activeLanguage)}</h4>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{pick(step.body, activeLanguage)}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="docs" className="scroll-mt-16 border-b border-border bg-background px-5 py-20 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.82fr)_minmax(360px,1.18fr)] lg:items-center">
            <div>
              <SectionMark label={copy.docsSection} />
              <h2 className="font-serif text-4xl leading-tight text-foreground md:text-5xl">{copy.docsTitle}</h2>
              <p className="mt-5 text-base leading-7 text-muted-foreground">{copy.docsBody}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {copy.docsCta}
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
                <a
                  href={readmeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  README
                </a>
              </div>
            </div>
            <div className="grid gap-3">
              {docCards.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article key={pick(feature.title, activeLanguage)} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 rounded-xl border border-border bg-card p-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="font-serif text-lg text-foreground">{pick(feature.title, activeLanguage)}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{pick(feature.body, activeLanguage)}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="download" className="scroll-mt-16 border-b border-border bg-card-alt/50 px-5 py-20 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(360px,0.55fr)]">
              <div>
                <SectionMark label={copy.deploySection} />
                <h2 className="font-serif text-4xl leading-tight text-foreground md:text-5xl">{copy.deployTitle}</h2>
                <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">{copy.deployBody}</p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <a
                    href={releasesUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {copy.primaryCta}
                  </a>
                  <a
                    href={changelogUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 items-center justify-center rounded-lg border border-input bg-background px-6 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {copy.changelogCta}
                  </a>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="font-serif text-lg text-foreground">{copy.sourceRunTitle}</span>
                  <Code2 className="h-4 w-4 text-primary" />
                </div>
                <pre className="overflow-x-auto bg-card-alt px-4 py-4 text-sm leading-6 text-foreground">
                  <code>{copy.installCommand}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-card px-5 py-16 lg:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-serif text-3xl leading-tight text-foreground md:text-4xl">{copy.headline}</h2>
              <p className="mt-3 text-sm text-muted-foreground">{copy.footerBody}</p>
            </div>
            <a
              href={releasesUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 w-fit items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {copy.primaryCta}
              <ChevronRight className="ml-2 h-4 w-4" />
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}

import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Github,
  Layers,
  Search,
  Terminal,
  WifiOff,
} from "lucide-react";

const logoUrl = new URL("../../assets/logo.svg", import.meta.url).href;
const coverUrl = new URL("../../docs/images/cover.png", import.meta.url).href;

const githubUrl = "https://github.com/lovstudio/Ataru";
const releasesUrl = `${githubUrl}/releases`;

const capabilities = [
  {
    icon: Search,
    title: "中文与代码都能命中",
    body: "Tantivy 搭配 Jieba 分词，同时覆盖中文表述、代码片段、包名、域名和错误串。",
  },
  {
    icon: Layers,
    title: "四种粒度自由切换",
    body: "同一次检索可以按 Turn、Run、Session、Project 聚合，避免被同一段对话反复占满结果。",
  },
  {
    icon: ArrowUpRight,
    title: "回到原文，而不是摘要",
    body: "每条命中都带稳定的会话、消息与行号标识，可以直接回读当时的上下文。",
  },
  {
    icon: WifiOff,
    title: "默认在本机完成",
    body: "索引与检索离线运行；语义召回是可选增强，未配置时会明确降级到关键词检索。",
  },
];

const surfaces = [
  {
    icon: Download,
    title: "桌面端",
    body: "完整检索界面，含语义与混合召回。",
    action: { label: "下载最新版本", href: releasesUrl },
  },
  {
    icon: Terminal,
    title: "JSON CLI",
    body: "无界面环境下的关键词检索与索引维护。",
  },
  {
    icon: Github,
    title: "Agent Skill",
    body: "让 Agent 自己确认索引、发起检索、回读上下文。",
    commands: ["npx lovstudio skills add ataru-indexing", "npx lovstudio skills add ataru-search"],
  },
];

function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{command}</code>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true))}
        aria-label={`复制命令：${command}`}
        title="复制"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/**
 * Public landing page for ataru.lovstudio.ai. Rendered as a standalone route:
 * no desktop app shell, no Tauri calls, safe to serve as a static page.
 */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt="" className="h-6 w-6" />
          <span className="font-serif text-[15px] font-semibold tracking-tight">Ataru</span>
        </div>
        <a
          href={githubUrl}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Github className="h-4 w-4" />
          GitHub
        </a>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 pb-24">
        <section className="pt-12 pb-14 sm:pt-20">
          <h1 className="max-w-2xl font-serif text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            把你和 AI 已经想清楚的事，重新找回来。
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
            Ataru 在本机为 Claude Code、Codex 和终端会话建立索引，让那些排查过的故障、定过的方案、写过的命令重新可检索。
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={releasesUrl}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Download className="h-4 w-4" />
              下载桌面端
            </a>
            <a
              href={githubUrl}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Github className="h-4 w-4" />
              查看源码
            </a>
            <span className="text-xs text-muted-foreground">macOS · Windows · Linux</span>
          </div>

          <div className="mt-12 overflow-hidden rounded-2xl border border-border bg-card">
            <img src={coverUrl} alt="Ataru 桌面端检索界面" className="block w-full" />
          </div>
        </section>

        <section className="border-t border-border pt-14">
          <h2 className="font-serif text-2xl font-semibold tracking-tight">检索这些历史，需要一点讲究</h2>
          <div className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {capabilities.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">{title}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16 border-t border-border pt-14">
          <h2 className="font-serif text-2xl font-semibold tracking-tight">三种用法，同一套检索契约</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {surfaces.map(({ icon: Icon, title, body, action, commands }) => (
              <div key={title} className="flex flex-col rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">{title}</h3>
                </div>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
                {action ? (
                  <a
                    href={action.href}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary transition-opacity hover:opacity-80"
                  >
                    {action.label}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                ) : null}
                {commands ? (
                  <div className="mt-3 space-y-1.5">
                    {commands.map((command) => (
                      <CommandRow key={command} command={command} />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            命令行与 Skill 走关键词检索；语义与混合召回目前只在桌面端提供。索引是派生数据，不会改写原始会话，重建失败时保留上一个可用索引。
          </p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-xs text-muted-foreground">
          <span>
            手工川工作室 · <a href="https://lovstudio.ai" className="transition-colors hover:text-foreground">Lovstudio.AI</a>
          </span>
          <span className="font-mono">v{__APP_VERSION__}</span>
        </div>
      </footer>
    </div>
  );
}

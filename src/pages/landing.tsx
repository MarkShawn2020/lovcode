import { useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Github,
  Scale,
  Terminal,
  WifiOff,
} from "lucide-react";

const logoUrl = new URL("../../assets/logo.svg", import.meta.url).href;

const githubUrl = "https://github.com/lovstudio/Ataru";
const releasesUrl = `${githubUrl}/releases`;

/** Levels and their copy come from the shipped search UI, not from marketing. */
const levels = [
  { label: "Project", body: "跨会话归并到项目" },
  { label: "Session", body: "同一会话中的多次执行" },
  { label: "Run", body: "一次完整执行里的多个 Turn" },
  { label: "Turn", body: "一条原子消息或工具记录" },
];

const proofPoints = [
  { icon: Scale, value: "Apache-2.0", label: "开源许可" },
  { icon: Terminal, value: "Rust", label: "检索内核" },
  { icon: WifiOff, value: "本机", label: "默认离线运行" },
];

const surfaces = [
  {
    title: "桌面端",
    body: "完整检索界面，关键词、语义与混合召回都在这里。",
    action: { label: "下载最新版本", href: releasesUrl },
  },
  {
    title: "JSON CLI",
    body: "无界面环境下的检索与索引维护，输出稳定 JSON。",
    note: "仅关键词模式",
  },
  {
    title: "Agent Skill",
    body: "让 Agent 自己确认索引、发起检索、按稳定 ID 回读原文。",
    commands: ["npx lovstudio skills add ataru-indexing", "npx lovstudio skills add ataru-search"],
  },
];

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
      aria-label={label}
      title={copied ? "已复制" : "复制"}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Section({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`mx-auto w-full max-w-5xl px-6 ${className}`}>{children}</section>;
}

/**
 * Illustrative rendition of the shipped search surface. Deliberately inert:
 * a fake input would be a dead control, so the query line is presentation only
 * and the caption says whose data real results come from.
 */
function RecallStage() {
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
        </div>

        <div className="px-4 py-4 sm:px-6 sm:py-6">
          <p className="rounded-xl border border-border bg-background px-4 py-3 font-mono text-[13px] text-foreground">
            上次索引没更新是怎么解决的
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {["ALL", "Project", "Session", "Run", "Turn"].map((level) => (
              <span
                key={level}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                  level === "Turn"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {level}
              </span>
            ))}
          </div>

          <ul className="mt-5 space-y-2.5">
            {[
              { level: "Turn", id: "session 4f2a · message 118 · line 2043" },
              { level: "Run", id: "session 4f2a · run 3 · 12 turns" },
              { level: "Project", id: "~/projects/ataru · 26 sessions" },
            ].map((hit, index) => (
              <li key={hit.id} className="rounded-xl border border-border bg-background px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="h-2 w-full max-w-[min(60%,18rem)] rounded-full bg-muted" style={{ opacity: 1 - index * 0.2 }} />
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {hit.level}
                  </span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">{hit.id}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">
        界面示意。真实结果来自你本机的会话文件，每条命中都带可回读的稳定标识。
      </figcaption>
    </figure>
  );
}

/**
 * Public landing page for ataru.lovstudio.ai. Standalone route: no desktop
 * shell, no Tauri calls, safe to serve as a static page.
 */
export default function LandingPage() {
  return (
    <div className="landing-theme min-h-screen">
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

      <main>
        <Section className="grid items-center gap-12 pt-10 pb-16 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] lg:gap-14 lg:pt-16">
          <div>
            <h1 className="font-serif text-[2.5rem] leading-[1.15] font-semibold tracking-tight sm:text-5xl">
              把想清楚的事，
              {/* Break only where the line is wide enough to hold the first
                  clause; on narrow screens natural wrapping reads better. */}
              <br className="hidden sm:inline" />
              重新找回来。
            </h1>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              那次故障是怎么排查的、方案为什么这么定、命令到底怎么写的——答案早就在你和 AI
              的会话里。Ataru 在本机把它们重新变成可检索的记忆。
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
            </div>
            <p className="mt-3 text-xs text-muted-foreground">macOS · Windows · Linux</p>
          </div>

          <RecallStage />
        </Section>

        <Section className="border-t border-border py-8">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
            {proofPoints.map(({ icon: Icon, value, label }) => (
              <div key={label}>
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </dt>
                <dd className="mt-1.5 font-serif text-xl font-semibold tracking-tight">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section className="border-t border-border py-16">
          <h2 className="max-w-lg font-serif text-3xl leading-tight font-semibold tracking-tight">
            一次命中，四种看法
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            同一句问题，可以要一条精确的原始消息，也可以要整个项目的来龙去脉。粒度由你选，命中不会被同一段对话反复占满。
          </p>

          <ol className="mt-10 space-y-0 border-t border-border">
            {levels.map(({ label, body }, index) => (
              <li
                key={label}
                className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-border py-4"
                style={{ paddingLeft: `${index * 1.25}rem` }}
              >
                <span className="font-mono text-[13px] font-medium text-primary">{label}</span>
                <span className="text-sm text-muted-foreground">{body}</span>
              </li>
            ))}
          </ol>

          <div className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold">中文与代码都能命中</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Tantivy 搭配 Jieba 分词，中文表述、代码片段、包名、域名和错误串走同一套索引。
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">回到原文，而不是摘要</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                命中带稳定的会话、消息与行号标识，可以直接回读当时的上下文，而不是读一段截断转述。
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">增量追赶，不重扫全部历史</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                索引是派生数据，不改写原始会话；新消息写入后自动追赶，重建失败时保留上一个可用索引。
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">离线优先，降级说清楚</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                检索默认在本机完成。语义召回是可选增强，未配置或超时会明确降级到关键词检索，不假装命中。
              </p>
            </div>
          </div>
        </Section>

        <Section className="border-t border-border py-16">
          <h2 className="font-serif text-3xl leading-tight font-semibold tracking-tight">
            三种用法，同一套检索契约
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            桌面端只是其中一个客户端。CLI 和 Agent Skill 复用同一套 Rust 检索内核，不维护第二套索引。
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {surfaces.map(({ title, body, action, note, commands }) => (
              <div key={title} className="flex flex-col rounded-xl border border-border bg-card p-5">
                <h3 className="font-serif text-lg font-semibold tracking-tight">{title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{body}</p>

                {action ? (
                  <a
                    href={action.href}
                    className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary transition-opacity hover:opacity-80"
                  >
                    {action.label}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                ) : null}

                {note ? <p className="mt-4 text-xs text-muted-foreground">{note}</p> : null}

                {commands ? (
                  <div className="mt-4 space-y-1.5">
                    {commands.map((command) => (
                      <div
                        key={command}
                        className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5"
                      >
                        <code title={command} className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                          {command}
                        </code>
                        <CopyButton value={command} label={`复制命令：${command}`} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Section>

        <Section className="border-t border-border py-16">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <h2 className="max-w-md font-serif text-3xl leading-tight font-semibold tracking-tight">
                你的历史已经在本机了。
              </h2>
              <p className="mt-3 text-[15px] text-muted-foreground">装上就能开始检索，不需要上传任何东西。</p>
            </div>
            <a
              href={releasesUrl}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Download className="h-4 w-4" />
              下载桌面端
            </a>
          </div>
        </Section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-xs text-muted-foreground">
          <span>
            手工川工作室 ·{" "}
            <a href="https://lovstudio.ai" className="transition-colors hover:text-foreground">
              Lovstudio.AI
            </a>
          </span>
          <span className="font-mono">v{__APP_VERSION__}</span>
        </div>
      </footer>
    </div>
  );
}

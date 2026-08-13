import { Settings2 } from "lucide-react";
import { AppUpdatePanel } from "@/components/AppUpdatePanel";

export default function SettingsPage() {
  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
            <Settings2 className="h-5 w-5" />
            <span className="text-sm font-medium">应用设置</span>
          </div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">设置</h1>
        </header>

        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-lg font-semibold text-foreground">本地体验</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            搜索索引、对话档案与应用偏好将在这里统一管理。
          </p>
        </section>

        <AppUpdatePanel />
      </div>
    </div>
  );
}

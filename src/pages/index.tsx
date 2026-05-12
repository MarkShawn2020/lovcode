import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [pong, setPong] = useState<string | null>(null);

  return (
    <main className="mx-auto max-w-3xl px-6 pt-20">
      <h1 className="font-serif text-3xl text-foreground">Lovcode</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Search every conversation you've ever had with an AI.
      </p>

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your conversations…"
        className="mt-8 w-full rounded-xl border border-border bg-card px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        autoFocus
      />

      <div className="mt-12 rounded-xl border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">v0.40 rewrite in progress.</p>
        <p className="mt-2">
          The search backend is being rebuilt on top of <code className="rounded bg-muted px-1.5 py-0.5 text-xs">lovcode-core</code>.
          Until phase 1.3 lands, this page is a placeholder.
        </p>
        <p className="mt-4">
          Legacy v0.39 codebase lives on the{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">legacy/v0.39-workbench</code> branch.
        </p>
        <button
          type="button"
          onClick={async () => setPong(await invoke<string>("ping"))}
          className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Ping backend
        </button>
        {pong && <span className="ml-3 text-foreground">→ {pong}</span>}
      </div>
    </main>
  );
}

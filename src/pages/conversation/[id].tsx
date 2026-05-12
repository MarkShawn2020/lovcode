import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getConversation, type Conversation } from "@/lib/api";

export default function ConversationDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id ? decodeURIComponent(params.id) : "";
  const [conv, setConv] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setConv(null);
    setError(null);
    getConversation(id).then(setConv).catch((e) => setError(String(e)));
  }, [id]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-baseline gap-4">
          <Link to="/" className="text-sm text-primary hover:underline">
            ← Search
          </Link>
          <h1 className="font-serif text-lg text-foreground truncate">
            {conv?.title ?? id}
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-6">
        {error && <p className="text-sm text-destructive">Error: {error}</p>}
        {!conv && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {conv && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{conv.source}</span>
              {conv.project && <span className="truncate">{conv.project}</span>}
              {conv.updated_at && (
                <span>{new Date(conv.updated_at).toISOString().slice(0, 19).replace("T", " ")}</span>
              )}
              <span>{conv.messages.length} messages</span>
            </div>

            <ol className="space-y-4">
              {conv.messages.map((m, i) => (
                <li
                  key={i}
                  className={`rounded-xl border border-border p-4 ${
                    m.role === "user" ? "bg-card" : "bg-muted/30"
                  }`}
                >
                  <div className="mb-2 text-xs font-mono uppercase tracking-wide text-muted-foreground">
                    {m.role}
                    {m.timestamp && (
                      <span className="ml-2 normal-case">
                        {new Date(m.timestamp).toISOString().slice(11, 19)}
                      </span>
                    )}
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm text-foreground">
                    {m.content}
                  </pre>
                </li>
              ))}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}

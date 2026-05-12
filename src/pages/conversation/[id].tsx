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
    <div className="min-h-full bg-paper paper-grain">
      <article className="mx-auto max-w-3xl px-8 py-12">
        <Link
          to="/"
          className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-ink-soft transition hover:text-cinnabar"
        >
          ← Archive
        </Link>

        {error && (
          <p className="mt-6 font-serif text-xl italic text-cinnabar-deep">! {error}</p>
        )}
        {!conv && !error && (
          <p className="mt-6 font-mono text-xs uppercase tracking-widest text-ink-faint">Reading…</p>
        )}

        {conv && (
          <>
            <header className="mt-6 border-b border-paper-edge pb-6">
              <div className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-ink-faint">
                <span>{conv.source}</span>
                <span className="h-px flex-1 bg-paper-edge" />
                <span className="tabular">
                  {conv.updated_at?.slice(0, 10) ?? "—"}
                </span>
                <span className="tabular">{conv.messages.length} turns</span>
              </div>
              <h1 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-ink">
                {conv.title ?? conv.id}
              </h1>
              {conv.project && (
                <p className="mt-2 font-mono text-[11px] text-ink-soft">{conv.project}</p>
              )}
            </header>

            <ol className="mt-8 space-y-6">
              {conv.messages.map((m, i) => (
                <li key={i} className="grid grid-cols-12 gap-4">
                  <div className="col-span-2 pt-1 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                    <div className={m.role === "user" ? "text-cinnabar" : "text-ink-soft"}>{m.role}</div>
                    {m.timestamp && (
                      <div className="tabular mt-1 text-ink-faint">
                        {m.timestamp.slice(11, 19)}
                      </div>
                    )}
                  </div>
                  <pre className="col-span-10 whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-ink">
                    {m.content}
                  </pre>
                </li>
              ))}
            </ol>
          </>
        )}
      </article>
    </div>
  );
}

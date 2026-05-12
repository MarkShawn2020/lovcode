// Floating search palette window (transparent NSPanel).
// Phase 1: placeholder shell. Real palette UI lands in phase 4.1.
export default function SearchOverlay() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-card/95 backdrop-blur">
      <div className="rounded-xl border border-border px-6 py-4 text-sm text-muted-foreground">
        Floating palette — rebuild pending (phase 4.1).
      </div>
    </div>
  );
}

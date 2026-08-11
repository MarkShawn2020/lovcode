type DevResumeWorkspaceState = {
  activeConversationId?: string | null;
  sessionListMode?: "active" | "archived";
};

type DevResumeState = {
  hash: string;
  updatedAt: number;
  workspace?: DevResumeWorkspaceState;
};

const DEV_RESUME_KEY = "lovcode:dev-resume";
const DEV_RESUME_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const NON_RESUMABLE_HASH_PREFIXES = ["#/search-overlay", "#/prompt-detail", "#/landing"];

function canUseDevResume() {
  return import.meta.env.DEV && typeof window !== "undefined";
}

function normalizeHash(hash: string) {
  if (!hash) return "";
  return hash.startsWith("#") ? hash : `#${hash}`;
}

function isResumableHash(hash: string) {
  const normalized = normalizeHash(hash);
  if (!normalized || normalized === "#" || normalized === "#/") return false;
  return !isStandaloneHash(normalized);
}

function isStandaloneHash(hash: string) {
  const normalized = normalizeHash(hash);
  return NON_RESUMABLE_HASH_PREFIXES.some((prefix) =>
    normalized === prefix || normalized.startsWith(`${prefix}?`)
  );
}

export function readDevResumeState(): DevResumeState | null {
  if (!canUseDevResume()) return null;
  try {
    const raw = window.localStorage.getItem(DEV_RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DevResumeState>;
    if (typeof parsed.updatedAt !== "number") return null;
    if (Date.now() - parsed.updatedAt > DEV_RESUME_MAX_AGE_MS) return null;
    const hash = normalizeHash(typeof parsed.hash === "string" ? parsed.hash : "");
    // Secondary windows share WKWebView localStorage with the main window.
    // Never let a transient popup route become the main-window resume target.
    if (!isResumableHash(hash)) return null;
    return {
      hash,
      updatedAt: parsed.updatedAt,
      workspace: parsed.workspace,
    };
  } catch {
    return null;
  }
}

function writeDevResumeState(patch: Partial<DevResumeState>) {
  if (!canUseDevResume()) return;
  try {
    const current = readDevResumeState();
    const next: DevResumeState = {
      hash: normalizeHash(patch.hash ?? current?.hash ?? window.location.hash),
      updatedAt: Date.now(),
      workspace: {
        ...(current?.workspace ?? {}),
        ...(patch.workspace ?? {}),
      },
    };
    window.localStorage.setItem(DEV_RESUME_KEY, JSON.stringify(next));
  } catch {
    // Resume state is best-effort dev ergonomics.
  }
}

export function saveCurrentLocationForDevResume() {
  if (!canUseDevResume()) return;
  const hash = normalizeHash(window.location.hash);
  if (!isResumableHash(hash)) return;
  writeDevResumeState({ hash });
}

export function restoreLocationForDevReload() {
  if (!canUseDevResume()) return;
  const currentHash = normalizeHash(window.location.hash);
  // Standalone windows (notably the always-created hidden search overlay)
  // must keep their own route and must not participate in main-window resume.
  if (isStandaloneHash(currentHash)) return;
  if (currentHash && currentHash !== "#/" && currentHash !== "#") return;

  const saved = readDevResumeState();
  if (!saved?.hash || saved.hash === currentHash) return;

  const nextUrl = `${window.location.pathname}${window.location.search}${saved.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

export function writeWorkspaceDevResumeState(workspace: DevResumeWorkspaceState) {
  writeDevResumeState({ hash: window.location.hash, workspace });
}

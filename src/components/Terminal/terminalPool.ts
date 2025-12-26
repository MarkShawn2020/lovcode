import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";

interface PooledTerminal {
  term: Terminal;
  fitAddon: FitAddon;
  container: HTMLDivElement;
}

// Persist state across HMR by attaching to window
declare global {
  interface Window {
    __terminalPool?: Map<string, PooledTerminal>;
    __ptyReadySessions?: Set<string>;
    __autoCopyDisposables?: Map<string, { dispose: () => void }>;
    __ptyInitLocks?: Map<string, Promise<void>>;
  }
}

/** Global pool of xterm instances keyed by session ID (survives HMR) */
const terminalPool: Map<string, PooledTerminal> =
  window.__terminalPool ?? (window.__terminalPool = new Map());

/** Track which PTY sessions are ready (survives HMR) */
export const ptyReadySessions: Set<string> =
  window.__ptyReadySessions ?? (window.__ptyReadySessions = new Set());

/** Track auto-copy disposables per session (survives HMR) */
const autoCopyDisposables: Map<string, { dispose: () => void }> =
  window.__autoCopyDisposables ?? (window.__autoCopyDisposables = new Map());

/** Global auto-copy enabled state */
let autoCopyEnabled = (() => {
  try {
    return localStorage.getItem("terminal:autoCopyOnSelect") === "true";
  } catch {
    return false;
  }
})();

/** Global lock to prevent concurrent PTY initialization (survives HMR) */
export const ptyInitLocks: Map<string, Promise<void>> =
  window.__ptyInitLocks ?? (window.__ptyInitLocks = new Map());

const TERMINAL_THEME = {
  background: "#1a1a1a",
  foreground: "#e0e0e0",
  cursor: "#CC785C",
  cursorAccent: "#1a1a1a",
  selectionBackground: "#CC785C40",
  black: "#1a1a1a",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#d19a66",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#abb2bf",
  brightBlack: "#5c6370",
  brightRed: "#e06c75",
  brightGreen: "#98c379",
  brightYellow: "#d19a66",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
  brightWhite: "#ffffff",
};

/**
 * Get or create a terminal instance for the given session ID.
 * If instance exists, just returns it (preserving history).
 * If not, creates new instance.
 */
export function getOrCreateTerminal(sessionId: string): PooledTerminal {
  const existing = terminalPool.get(sessionId);
  if (existing) {
    return existing;
  }

  // Create new terminal
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "Monaco, Menlo, 'DejaVu Sans Mono', Consolas, monospace",
    lineHeight: 1.2,
    macOptionIsMeta: true,
    allowProposedApi: true,
    theme: TERMINAL_THEME,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon((_event, uri) => {
    openUrl(uri).catch(console.error);
  }));

  // Create a detached container for the terminal
  const container = document.createElement("div");
  container.style.width = "100%";
  container.style.height = "100%";

  // Open terminal in the detached container
  term.open(container);

  const pooled: PooledTerminal = { term, fitAddon, container };
  terminalPool.set(sessionId, pooled);

  // Setup auto-copy if enabled
  setupAutoCopy(sessionId, term);

  return pooled;
}

/**
 * Attach a pooled terminal to a target element.
 * Moves the terminal's container DOM into the target.
 */
export function attachTerminal(sessionId: string, target: HTMLElement): PooledTerminal | null {
  const pooled = terminalPool.get(sessionId);
  if (!pooled) return null;

  // Move container to target
  target.appendChild(pooled.container);

  // Fit after DOM move
  requestAnimationFrame(() => {
    pooled.fitAddon.fit();
  });

  return pooled;
}

/**
 * Detach a pooled terminal from its current parent.
 * Does NOT dispose - keeps instance alive for reattachment.
 */
export function detachTerminal(sessionId: string): void {
  const pooled = terminalPool.get(sessionId);
  if (!pooled) return;

  // Remove from DOM but keep in pool
  if (pooled.container.parentElement) {
    pooled.container.remove();
  }
}

/**
 * Dispose and remove a terminal from the pool.
 * Called when session is explicitly closed.
 */
export function disposeTerminal(sessionId: string): void {
  const pooled = terminalPool.get(sessionId);
  if (!pooled) return;

  autoCopyDisposables.get(sessionId)?.dispose();
  autoCopyDisposables.delete(sessionId);
  pooled.term.dispose();
  pooled.container.remove();
  terminalPool.delete(sessionId);
  ptyReadySessions.delete(sessionId);
}

/**
 * Check if a terminal exists in the pool.
 */
export function hasTerminal(sessionId: string): boolean {
  return terminalPool.has(sessionId);
}

/** Setup auto-copy listener for a terminal */
function setupAutoCopy(sessionId: string, term: Terminal): void {
  // Clean up existing
  autoCopyDisposables.get(sessionId)?.dispose();
  autoCopyDisposables.delete(sessionId);

  if (!autoCopyEnabled) return;

  const disposable = term.onSelectionChange(() => {
    const selection = term.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection).catch(() => {});
    }
  });

  autoCopyDisposables.set(sessionId, disposable);
}

/** Set auto-copy on select enabled state */
export function setAutoCopyOnSelect(enabled: boolean): void {
  autoCopyEnabled = enabled;
  localStorage.setItem("terminal:autoCopyOnSelect", String(enabled));

  // Update all existing terminals
  for (const [sessionId, pooled] of terminalPool) {
    setupAutoCopy(sessionId, pooled.term);
  }
}

/** Get auto-copy on select enabled state */
export function getAutoCopyOnSelect(): boolean {
  return autoCopyEnabled;
}

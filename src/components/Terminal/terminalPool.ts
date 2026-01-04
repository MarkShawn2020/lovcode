import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { openUrl } from "@tauri-apps/plugin-opener";

interface PooledTerminal {
  term: Terminal;
  fitAddon: FitAddon;
  container: HTMLDivElement;
  webglAddon: WebglAddon | null;
  lastAccessed: number;
}

// Maximum WebGL contexts to keep active (browser limit is ~16, keep margin)
const MAX_WEBGL_CONTEXTS = 6;

// Persist state across HMR by attaching to window
declare global {
  interface Window {
    __terminalPool?: Map<string, PooledTerminal>;
    __ptyReadySessions?: Set<string>;
    __autoCopyDisposables?: Map<string, { dispose: () => void }>;
    __ptyInitLocks?: Map<string, Promise<void>>;
    __webglSessionOrder?: string[];
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

/** Track WebGL session order for LRU eviction (survives HMR) */
const webglSessionOrder: string[] =
  window.__webglSessionOrder ?? (window.__webglSessionOrder = []);

const TERMINAL_THEME = {
  background: "#1a1a1a",
  foreground: "#e0e0e0",
  cursor: "#CC785C",
  cursorAccent: "#1a1a1a",
  selectionBackground: "#CC785C40",
  black: "#4a4a4a", // Lighter than background to remain visible
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
 * Clean up orphan session IDs from webglSessionOrder.
 * These are sessions that no longer exist in terminalPool (e.g., after HMR).
 */
function cleanupOrphanSessions(): void {
  for (let i = webglSessionOrder.length - 1; i >= 0; i--) {
    const id = webglSessionOrder[i];
    if (!terminalPool.has(id)) {
      webglSessionOrder.splice(i, 1);
    }
  }
}

/**
 * Evict oldest WebGL contexts when limit is reached.
 * Uses LRU strategy based on lastAccessed timestamp.
 */
function evictOldestWebGL(): void {
  // First clean up orphan sessions that may have accumulated
  cleanupOrphanSessions();

  // Find sessions with active WebGL (must use !! to handle undefined correctly)
  // pooled?.webglAddon returns undefined if pooled doesn't exist
  // undefined !== null is true, which is wrong - we need !!
  const sessionsWithWebGL = webglSessionOrder.filter((id) => {
    const pooled = terminalPool.get(id);
    return !!pooled?.webglAddon;
  });

  // Evict oldest until we're under limit
  while (sessionsWithWebGL.length >= MAX_WEBGL_CONTEXTS) {
    const oldestId = sessionsWithWebGL.shift();
    if (!oldestId) break;

    const pooled = terminalPool.get(oldestId);
    if (pooled?.webglAddon) {
      pooled.webglAddon.dispose();
      pooled.webglAddon = null;
      // Remove from order tracking
      const idx = webglSessionOrder.indexOf(oldestId);
      if (idx !== -1) webglSessionOrder.splice(idx, 1);
    }
  }
}

/**
 * Update WebGL session access order (move to end = most recently used).
 */
function touchWebGLSession(sessionId: string): void {
  const idx = webglSessionOrder.indexOf(sessionId);
  if (idx !== -1) {
    webglSessionOrder.splice(idx, 1);
  }
  webglSessionOrder.push(sessionId);
}

/**
 * Try to load WebGL addon, respecting global context limit.
 * Returns the addon if loaded, null if limit reached or unavailable.
 */
function tryLoadWebGL(sessionId: string, term: Terminal): WebglAddon | null {
  // Evict oldest if at limit
  evictOldestWebGL();

  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      // On context loss, clean up and remove from tracking
      webglAddon.dispose();
      const pooled = terminalPool.get(sessionId);
      if (pooled) pooled.webglAddon = null;
      const idx = webglSessionOrder.indexOf(sessionId);
      if (idx !== -1) webglSessionOrder.splice(idx, 1);
    });
    term.loadAddon(webglAddon);
    touchWebGLSession(sessionId);
    return webglAddon;
  } catch {
    // WebGL not available, use default canvas renderer
    return null;
  }
}

/**
 * Get or create a terminal instance for the given session ID.
 * If instance exists, just returns it (preserving history).
 * If not, creates new instance.
 * NOTE: WebGL is NOT loaded here - call ensureWebGL() separately for visible terminals.
 */
export function getOrCreateTerminal(sessionId: string): PooledTerminal {
  const existing = terminalPool.get(sessionId);
  if (existing) {
    // Update access time
    existing.lastAccessed = Date.now();
    return existing;
  }

  // Create new terminal
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "Monaco, Menlo, 'DejaVu Sans Mono', Consolas, monospace",
    lineHeight: 1.2,
    macOptionIsMeta: false,
    allowProposedApi: true,
    scrollOnUserInput: false, // Let PTY output control scrolling, not user keystrokes
    theme: TERMINAL_THEME,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon((_event, uri) => {
    openUrl(uri).catch(console.error);
  }));

  // Unicode11 addon for proper CJK character width calculation
  const unicode11Addon = new Unicode11Addon();
  term.loadAddon(unicode11Addon);
  term.unicode.activeVersion = "11";

  // Create a detached container for the terminal
  const container = document.createElement("div");
  container.style.width = "100%";
  container.style.height = "100%";

  // Open terminal in the detached container
  term.open(container);

  // Note: WebGL is loaded on-demand via ensureWebGL() when terminal becomes visible
  // This prevents WebGL context exhaustion when many terminals are mounted

  const pooled: PooledTerminal = { term, fitAddon, container, webglAddon: null, lastAccessed: Date.now() };
  terminalPool.set(sessionId, pooled);

  // Setup auto-copy if enabled
  setupAutoCopy(sessionId, term);

  return pooled;
}

/**
 * Load WebGL addon for a terminal if not already loaded.
 * Call this when terminal becomes visible.
 */
export function ensureWebGL(sessionId: string): void {
  const pooled = terminalPool.get(sessionId);
  if (!pooled || pooled.webglAddon) return; // Already loaded or not found

  pooled.webglAddon = tryLoadWebGL(sessionId, pooled.term);
}

/**
 * Unload WebGL addon for a terminal to free context.
 * Call this when terminal becomes invisible.
 */
export function releaseWebGL(sessionId: string): void {
  const pooled = terminalPool.get(sessionId);
  if (!pooled?.webglAddon) return;

  pooled.webglAddon.dispose();
  pooled.webglAddon = null;
  const idx = webglSessionOrder.indexOf(sessionId);
  if (idx !== -1) webglSessionOrder.splice(idx, 1);
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

  // Clean up WebGL addon first (before term.dispose)
  if (pooled.webglAddon) {
    pooled.webglAddon.dispose();
    pooled.webglAddon = null;
  }
  // Remove from WebGL tracking order
  const webglIdx = webglSessionOrder.indexOf(sessionId);
  if (webglIdx !== -1) webglSessionOrder.splice(webglIdx, 1);

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

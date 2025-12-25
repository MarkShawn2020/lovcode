import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import {
  getOrCreateTerminal,
  attachTerminal,
  detachTerminal,
  ptyReadySessions,
  ptyInitLocks,
} from "./terminalPool";

interface PtyDataEvent {
  id: string;
  data: number[];
}

interface PtyExitEvent {
  id: string;
}

export interface TerminalPaneProps {
  /** Unique identifier for this terminal session */
  ptyId: string;
  /** Working directory for the shell */
  cwd: string;
  /** Optional command to run instead of shell */
  command?: string;
  /** Auto focus terminal when ready */
  autoFocus?: boolean;
  /** Callback when terminal is ready */
  onReady?: () => void;
  /** Callback when terminal session ends */
  onExit?: () => void;
  /** Callback when title changes */
  onTitleChange?: (title: string) => void;
  /** Custom class name */
  className?: string;
}

export function TerminalPane({
  ptyId,
  cwd,
  command,
  autoFocus = false,
  onReady,
  onExit,
  onTitleChange,
  className = "",
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cwdRef = useRef(cwd);
  const commandRef = useRef(command);
  const autoFocusRef = useRef(autoFocus);
  const onReadyRef = useRef(onReady);
  const onExitRef = useRef(onExit);
  const onTitleChangeRef = useRef(onTitleChange);

  useEffect(() => { cwdRef.current = cwd; }, [cwd]);
  useEffect(() => { commandRef.current = command; }, [command]);
  useEffect(() => { autoFocusRef.current = autoFocus; }, [autoFocus]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  useEffect(() => { onTitleChangeRef.current = onTitleChange; }, [onTitleChange]);

  // Initialize terminal and PTY
  useEffect(() => {
    if (!containerRef.current) return;
    const sessionId = ptyId;

    // Get or create pooled terminal (preserves history on remount)
    const pooled = getOrCreateTerminal(sessionId);
    const { term, fitAddon } = pooled;

    // Attach to this component's container
    containerRef.current.appendChild(pooled.container);

    // Fit after attach
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Track mount state
    const mountState = { isMounted: true };

    // IME Shift+symbol fix: detect dropped characters and resend
    // xterm.js may drop the first Shift+symbol when Chinese IME is active
    const IME_RESEND_DELAY_MS = 200;
    let pendingChar: string | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    let dataReceived = false;
    let isComposing = false;

    const handleInputEvent = (event: InputEvent) => {
      if (!pendingChar) return;
      if (!event.inputType.startsWith("insert")) return;

      dataReceived = true;
      const data = event.data ?? "";
      const isCompositionInput = event.inputType.startsWith("insertComposition");
      const hasNonAscii = data !== "" && /[^\x00-\x7f]/.test(data);

      if (data.includes(pendingChar) || hasNonAscii || isCompositionInput) {
        clearPending();
      }
    };

    const clearPending = () => {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      pendingChar = null;
      dataReceived = false;
    };

    const textarea = pooled.container.querySelector("textarea");
    const handleCompositionStart = () => {
      isComposing = true;
      clearPending();
    };
    const handleCompositionEnd = () => {
      isComposing = false;
    };

    if (textarea) {
      textarea.addEventListener("compositionstart", handleCompositionStart);
      textarea.addEventListener("compositionend", handleCompositionEnd);
      textarea.addEventListener("beforeinput", handleInputEvent);
      textarea.addEventListener("input", handleInputEvent);
    }

    const customKeyHandler = (event: KeyboardEvent) => {
      if (event.type !== "keydown") return true;
      if (event.isComposing || isComposing) return true;
      if (!ptyReadySessions.has(sessionId)) return true;
      if (event.key === "Process" || event.key === "Unidentified") return true;
      if (event.keyCode === 229) return true;

      if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const key = event.key;
        // Detect punctuation (single char, not alphanumeric/space)
        if (key.length === 1 && !/^[a-zA-Z0-9\s]$/.test(key)) {
          pendingChar = key;
          dataReceived = false;

          if (pendingTimer) clearTimeout(pendingTimer);
          pendingTimer = setTimeout(() => {
            // If no data arrives within the delay, the char was dropped - resend it.
            if (pendingChar && !dataReceived && !isComposing) {
              const encoder = new TextEncoder();
              invoke("pty_write", { id: sessionId, data: Array.from(encoder.encode(pendingChar)) });
            }
            pendingChar = null;
            pendingTimer = null;
          }, IME_RESEND_DELAY_MS);
        }
      }
      return true; // Let xterm handle normally
    };
    term.attachCustomKeyEventHandler(customKeyHandler);

    // Initialize PTY session
    const initPty = async () => {
      const pendingInit = ptyInitLocks.get(sessionId);
      if (pendingInit) {
        await pendingInit;
      }

      if (!mountState.isMounted) return;

      let resolveLock: () => void;
      const lockPromise = new Promise<void>((resolve) => {
        resolveLock = resolve;
      });
      ptyInitLocks.set(sessionId, lockPromise);

      try {
        const exists = await invoke<boolean>("pty_exists", { id: sessionId });

        if (!mountState.isMounted) return;

        if (!exists) {
          await invoke("pty_create", { id: sessionId, cwd: cwdRef.current, command: commandRef.current });
        }

        ptyReadySessions.add(sessionId);

        if (!mountState.isMounted) return;

        await invoke("pty_resize", {
          id: sessionId,
          cols: term.cols,
          rows: term.rows,
        }).catch(() => {});

        console.log('[DEBUG][TerminalPane] PTY ready', { sessionId, autoFocus: autoFocusRef.current });
        // Focus if autoFocus is true when PTY becomes ready
        if (autoFocusRef.current) {
          requestAnimationFrame(() => {
            console.log('[DEBUG][TerminalPane] Focus on PTY ready', { sessionId });
            term.focus();
          });
        }
        onReadyRef.current?.();
      } catch (err) {
        if (mountState.isMounted) {
          console.error("Failed to initialize PTY:", err);
          term.writeln(`\r\n\x1b[31mFailed to create terminal: ${err}\x1b[0m`);
        }
      } finally {
        ptyInitLocks.delete(sessionId);
        resolveLock!();
      }
    };

    // Handle user input
    const onDataDisposable = term.onData((data) => {
      if (!ptyReadySessions.has(sessionId)) return;

      // Mark that we received data (for IME fix)
      if (pendingChar) {
        dataReceived = true;
        // If received data contains the pending char, clear the timer
        if (data.includes(pendingChar)) {
          pendingChar = null;
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
          }
        }
      }

      const encoder = new TextEncoder();
      const bytes = Array.from(encoder.encode(data));
      invoke("pty_write", { id: sessionId, data: bytes }).catch(console.error);
    });

    // Handle title changes
    const onTitleDisposable = term.onTitleChange((title) => {
      onTitleChangeRef.current?.(title);
    });

    // Listen for PTY data events
    const unlistenData = listen<PtyDataEvent>("pty-data", (event) => {
      if (event.payload.id === sessionId && mountState.isMounted) {
        const bytes = new Uint8Array(event.payload.data);
        const text = new TextDecoder().decode(bytes);
        term.write(text);
      }
    });

    // Listen for PTY exit events
    const unlistenExit = listen<PtyExitEvent>("pty-exit", (event) => {
      if (event.payload.id === sessionId && mountState.isMounted) {
        onExitRef.current?.();
      }
    });

    initPty();

    // Cleanup - detach but don't dispose (preserves instance for reattachment)
    return () => {
      mountState.isMounted = false;
      if (pendingTimer) clearTimeout(pendingTimer);
      if (textarea) {
        textarea.removeEventListener("compositionstart", handleCompositionStart);
        textarea.removeEventListener("compositionend", handleCompositionEnd);
        textarea.removeEventListener("beforeinput", handleInputEvent);
        textarea.removeEventListener("input", handleInputEvent);
      }
      onDataDisposable.dispose();
      onTitleDisposable.dispose();
      unlistenData.then((fn) => fn());
      unlistenExit.then((fn) => fn());

      // Just detach from DOM, keep terminal alive in pool
      detachTerminal(sessionId);
    };
  }, [ptyId]); // Only re-run when ptyId changes (reload), not cwd/command

  // Handle resize
  const handleResize = useCallback(() => {
    const pooled = attachTerminal(ptyId, containerRef.current!);
    if (!pooled) return;

    pooled.fitAddon.fit();

    if (ptyReadySessions.has(ptyId)) {
      const { cols, rows } = pooled.term;
      invoke("pty_resize", { id: ptyId, cols, rows }).catch(console.error);
    }
  }, [ptyId]);

  // Observe container size changes
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [handleResize]);

  // Auto-focus when autoFocus prop becomes true
  useEffect(() => {
    if (!autoFocus) return;
    if (!ptyReadySessions.has(ptyId)) return;

    const pooled = attachTerminal(ptyId, containerRef.current!);
    if (pooled) {
      console.log('[DEBUG][TerminalPane] autoFocus triggered', { ptyId });
      pooled.term.focus();
    }
  }, [autoFocus, ptyId]);

  // Focus terminal on click
  const handleClick = useCallback(() => {
    const pooled = attachTerminal(ptyId, containerRef.current!);
    pooled?.term.focus();
  }, [ptyId]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full bg-[#1a1a1a] ${className}`}
      onClick={handleClick}
    />
  );
}

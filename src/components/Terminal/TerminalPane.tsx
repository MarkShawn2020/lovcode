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

    // IME Fix: Handle direct non-ASCII input (Shift+punctuation) to bypass xterm's buggy CompositionHelper
    // Composition input (pinyin) should go through xterm normally
    // See: https://github.com/xtermjs/xterm.js/issues/3070
    const textarea = pooled.container.querySelector('textarea') as HTMLTextAreaElement;
    let handlingDirectNonAscii = false;
    let justFinishedComposition = false;
    let lastDirectInputSent: string | null = null;

    if (textarea) {
      // Track composition state
      let isComposing = false;
      textarea.addEventListener('compositionstart', () => {
        isComposing = true;
      }, { capture: true });
      textarea.addEventListener('compositionend', () => {
        isComposing = false;
        justFinishedComposition = true;
      }, { capture: true });

      // Use beforeinput to intercept BEFORE the character enters textarea
      textarea.addEventListener('beforeinput', (e) => {
        const ie = e as InputEvent;

        // Skip composition input
        if (isComposing || justFinishedComposition) {
          justFinishedComposition = false;
          return;
        }

        // Only handle direct non-ASCII input (Shift+punctuation)
        if (ie.inputType === 'insertText' && ie.data && /[^\x00-\x7f]/.test(ie.data)) {
          e.preventDefault(); // Prevent xterm from seeing it at all
          handlingDirectNonAscii = true;
          lastDirectInputSent = ie.data;
          // Send directly to PTY
          if (ptyReadySessions.has(sessionId)) {
            const encoder = new TextEncoder();
            invoke("pty_write", { id: sessionId, data: Array.from(encoder.encode(ie.data)) });
          }
        }
      }, { capture: true });
    }

    // Block xterm's keydown processing when we just handled direct non-ASCII input
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && handlingDirectNonAscii) {
        handlingDirectNonAscii = false;
        return false;
      }
      return true;
    });

    // Track mount state
    const mountState = { isMounted: true };

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
        } else {
          // PTY exists - replay scrollback buffer (e.g., after page refresh)
          const scrollback = await invoke<number[]>("pty_scrollback", { id: sessionId });
          if (scrollback.length > 0 && mountState.isMounted) {
            const bytes = new Uint8Array(scrollback);
            const text = new TextDecoder().decode(bytes);
            term.write(text);
          }
        }

        ptyReadySessions.add(sessionId);

        if (!mountState.isMounted) return;

        await invoke("pty_resize", {
          id: sessionId,
          cols: term.cols,
          rows: term.rows,
        }).catch(() => {});

        // Focus if autoFocus is true when PTY becomes ready
        if (autoFocusRef.current) {
          // Use double rAF to ensure DOM is fully painted before focus
          requestAnimationFrame(() => {
            fitAddon.fit();
            requestAnimationFrame(() => {
              term.focus();
            });
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
      // Skip if this exact data was already sent by our direct input handler
      if (lastDirectInputSent === data) {
        lastDirectInputSent = null;
        return;
      }
      // Skip ASCII punctuation that accompanies direct non-ASCII input (e.g., "(" when IME produces "（")
      if (lastDirectInputSent && /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/.test(data)) {
        lastDirectInputSent = null;
        return;
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

    const oldCols = pooled.term.cols;
    const oldRows = pooled.term.rows;
    pooled.fitAddon.fit();
    const newCols = pooled.term.cols;
    const newRows = pooled.term.rows;

    console.log('[DEBUG][TerminalPane] handleResize:', {
      ptyId,
      oldSize: { cols: oldCols, rows: oldRows },
      newSize: { cols: newCols, rows: newRows },
      containerSize: containerRef.current ? {
        width: containerRef.current.offsetWidth,
        height: containerRef.current.offsetHeight,
      } : null,
    });

    if (ptyReadySessions.has(ptyId)) {
      invoke("pty_resize", { id: ptyId, cols: newCols, rows: newRows }).catch(console.error);
    }
  }, [ptyId]);

  // Observe container size changes (debounced to avoid SIGWINCH spam)
  useEffect(() => {
    if (!containerRef.current) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      console.log('[DEBUG][TerminalPane] ResizeObserver triggered:', {
        ptyId,
        contentRect: entry?.contentRect ? {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        } : null,
      });
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 100);
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
    };
  }, [handleResize]);

  // Auto-focus when autoFocus prop becomes true
  useEffect(() => {
    if (!autoFocus) return;
    if (!ptyReadySessions.has(ptyId)) return;

    const pooled = attachTerminal(ptyId, containerRef.current!);
    if (pooled) {
      // Use double rAF to ensure DOM is fully painted before focus
      requestAnimationFrame(() => {
        pooled.fitAddon.fit();
        requestAnimationFrame(() => {
          pooled.term.focus();
        });
      });
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

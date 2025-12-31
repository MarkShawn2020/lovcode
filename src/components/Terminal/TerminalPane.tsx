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
    // Track the key press that triggered direct non-ASCII input
    // We use a counter to identify key presses, avoiding timing issues with flags
    let currentKeyPressId = 0;
    let directInputKeyPressId = -1;
    let lastDirectInputSent: string | null = null;

    if (textarea) {
      // Increment key press counter on each keydown
      textarea.addEventListener('keydown', () => {
        currentKeyPressId++;
      }, { capture: true });

      // Use beforeinput to intercept BEFORE the character enters textarea
      // inputType 'insertText' is for direct input, 'insertCompositionText' is for IME composition
      textarea.addEventListener('beforeinput', (e) => {
        const ie = e as InputEvent;

        // Only handle direct non-ASCII input (Shift+punctuation), not composition
        if (ie.inputType === 'insertText' && ie.data && /[^\x00-\x7f]/.test(ie.data)) {
          e.preventDefault(); // Prevent xterm from seeing it at all
          directInputKeyPressId = currentKeyPressId;
          lastDirectInputSent = ie.data;
          // Send directly to PTY
          if (ptyReadySessions.has(sessionId)) {
            const encoder = new TextEncoder();
            invoke("pty_write", { id: sessionId, data: Array.from(encoder.encode(ie.data)) });
          }
        }
      }, { capture: true });
    }

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
        }

        // Replay scrollback buffer (works for both page refresh and app restart)
        const scrollback = await invoke<number[]>("pty_scrollback", { id: sessionId });
        if (scrollback.length > 0 && mountState.isMounted) {
          const bytes = new Uint8Array(scrollback);
          const text = new TextDecoder().decode(bytes);
          term.write(text);
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
              // Don't steal focus from input/textarea
              const active = document.activeElement;
              if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
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

    // macOS keyboard shortcuts - directly write to PTY for better compatibility
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      if (!ptyReadySessions.has(sessionId)) return true;

      // Shift+Enter: bracketed paste with U+2028 (Line Separator)
      if (event.key === 'Enter' && event.shiftKey) {
        invoke("pty_write", { id: sessionId, data: [0x1b, 0x5b, 0x32, 0x30, 0x30, 0x7e, 0xe2, 0x80, 0xa8, 0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e] });
        return false;
      }

      // Cmd+Left: Home (line start) - try multiple sequences
      if (event.key === 'ArrowLeft' && event.metaKey && !event.altKey) {
        // Send Ctrl+A (0x01) - emacs style line start
        invoke("pty_write", { id: sessionId, data: [0x01] });
        return false;
      }

      // Cmd+Right: End (line end)
      if (event.key === 'ArrowRight' && event.metaKey && !event.altKey) {
        // Send Ctrl+E (0x05) - emacs style line end
        invoke("pty_write", { id: sessionId, data: [0x05] });
        return false;
      }

      // Cmd+Backspace: Delete to line start
      if (event.key === 'Backspace' && event.metaKey && !event.altKey) {
        // Send Ctrl+U (0x15) - kill line backward
        invoke("pty_write", { id: sessionId, data: [0x15] });
        return false;
      }

      // Option+Left: Word backward
      if (event.key === 'ArrowLeft' && event.altKey && !event.metaKey) {
        // Send ESC b (Alt+b) - backward word
        invoke("pty_write", { id: sessionId, data: [0x1b, 0x62] });
        return false;
      }

      // Option+Right: Word forward
      if (event.key === 'ArrowRight' && event.altKey && !event.metaKey) {
        // Send ESC f (Alt+f) - forward word
        invoke("pty_write", { id: sessionId, data: [0x1b, 0x66] });
        return false;
      }

      // Option+Backspace: Delete word backward
      if (event.key === 'Backspace' && event.altKey && !event.metaKey) {
        // Send Ctrl+W (0x17) - kill word backward
        invoke("pty_write", { id: sessionId, data: [0x17] });
        return false;
      }

      return true;
    });

    // Handle user input
    const onDataDisposable = term.onData((data) => {
      if (!ptyReadySessions.has(sessionId)) return;

      // Check if this data is from the same key press as our direct non-ASCII input
      const isSameKeyPress = directInputKeyPressId === currentKeyPressId;

      if (isSameKeyPress && lastDirectInputSent) {
        // Skip if this exact data was already sent by our direct input handler
        if (lastDirectInputSent === data) {
          lastDirectInputSent = null;
          return;
        }
        // Skip ASCII punctuation that accompanies direct non-ASCII input
        // (e.g., xterm sends "(" from keydown while IME produces "（")
        if (/^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/.test(data)) {
          lastDirectInputSent = null;
          return;
        }
      }

      // Clear stale state from previous key presses
      if (!isSameKeyPress) {
        lastDirectInputSent = null;
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
    // Use streaming decoder to handle multi-byte UTF-8 chars split across events
    const decoder = new TextDecoder("utf-8", { fatal: false });

    // Batch PTY data to reduce render frequency and prevent flicker
    // When data arrives faster than frame rate, multiple writes cause visual jitter
    let pendingBytes: number[] = [];
    let writeFrameId: number | null = null;
    let writeCount = 0;
    let batchCount = 0;

    const flushPendingData = () => {
      writeFrameId = null;
      if (pendingBytes.length === 0 || !mountState.isMounted) return;

      writeCount++;
      const bytes = new Uint8Array(pendingBytes);
      pendingBytes = [];
      const text = decoder.decode(bytes, { stream: true });

      // Lock scroll position during write to prevent flicker from intermediate states
      const viewport = pooled.container.querySelector('.xterm-viewport') as HTMLElement;
      if (viewport) {
        const scrollTop = viewport.scrollTop;
        const onScroll = () => { viewport.scrollTop = scrollTop; };
        viewport.addEventListener('scroll', onScroll);
        term.write(text, () => {
          // Remove scroll lock after write completes
          viewport.removeEventListener('scroll', onScroll);
        });
      } else {
        term.write(text);
      }
    };

    const unlistenData = listen<PtyDataEvent>("pty-data", (event) => {
      if (event.payload.id === sessionId && mountState.isMounted) {
        // Accumulate raw bytes (preserves UTF-8 boundary handling)
        pendingBytes.push(...event.payload.data);
        batchCount++;

        // Schedule single write per frame
        if (writeFrameId === null) {
          writeFrameId = requestAnimationFrame(flushPendingData);
          batchCount = 1; // Reset batch count for this frame
        }
      }
    });

    // Listen for PTY exit events
    const unlistenExit = listen<PtyExitEvent>("pty-exit", (event) => {
      if (event.payload.id === sessionId && mountState.isMounted) {
        // Don't auto-close sessions that ran a command - keep scrollback visible
        // User can manually close or reload. Only auto-close shell sessions.
        if (!commandRef.current) {
          onExitRef.current?.();
        }
      }
    });

    initPty();

    // Cleanup - detach but don't dispose (preserves instance for reattachment)
    return () => {
      mountState.isMounted = false;
      if (writeFrameId !== null) {
        cancelAnimationFrame(writeFrameId);
      }
      pendingBytes = [];
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
    const newCols = pooled.term.cols;
    const newRows = pooled.term.rows;

    if (ptyReadySessions.has(ptyId)) {
      invoke("pty_resize", { id: ptyId, cols: newCols, rows: newRows }).catch(console.error);
    }
  }, [ptyId]);

  // Observe container size changes (debounced to avoid SIGWINCH spam)
  useEffect(() => {
    if (!containerRef.current) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
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
          // Don't steal focus from input/textarea
          const active = document.activeElement;
          if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
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

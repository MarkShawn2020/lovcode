import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

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
  onReady,
  onExit,
  onTitleChange,
  className = "",
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onReadyRef = useRef(onReady);
  const onExitRef = useRef(onExit);
  const onTitleChangeRef = useRef(onTitleChange);
  // Use ptyId prop as session ID to support PTY reuse across remounts
  const sessionIdRef = useRef<string>(ptyId);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  // Initialize terminal and PTY
  useEffect(() => {
    console.log('[DEBUG][TerminalPane] useEffect 触发, ptyId:', ptyId);
    if (!containerRef.current) return;
    // Update sessionIdRef when ptyId changes (e.g., on reload)
    sessionIdRef.current = ptyId;
    const sessionId = sessionIdRef.current;

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Monaco, Menlo, 'DejaVu Sans Mono', Consolas, monospace",
      lineHeight: 1.2,
      theme: {
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
      },
    });

    // Add fit addon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Add web links addon
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(webLinksAddon);

    // Open terminal in container
    term.open(containerRef.current);
    terminalRef.current = term;

    // Debug: track key events to diagnose shift+symbol issue
    term.attachCustomKeyEventHandler((event) => {
      if (event.shiftKey || event.key === 'Shift') {
        console.log('[DEBUG] keyEvent:', event.type, 'key:', event.key, 'code:', event.code, 'shift:', event.shiftKey, 'isComposing:', event.isComposing);
      }
      return true;
    });

    // Fit terminal to container
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Track cleanup state - use object to avoid closure stale value
    const mountState = { isMounted: true };

    // Initialize PTY session (create if not exists, reuse if exists)
    const initPty = async () => {
      try {
        // Check mount state before async operation
        if (!mountState.isMounted) {
          console.log('[DEBUG][TerminalPane] initPty 取消 - 组件已卸载');
          return;
        }

        // Check if PTY session already exists (supports remounting without killing process)
        const exists = await invoke<boolean>("pty_exists", { id: sessionId });
        console.log('[DEBUG][TerminalPane] initPty - sessionId:', sessionId, 'exists:', exists, 'isMounted:', mountState.isMounted);

        // Check mount state after async operation
        if (!mountState.isMounted) {
          console.log('[DEBUG][TerminalPane] initPty 取消 - 组件已卸载 (after exists check)');
          return;
        }

        if (!exists) {
          // Create new PTY session only if it doesn't exist
          console.log('[DEBUG][TerminalPane] 创建新 PTY session');
          await invoke("pty_create", { id: sessionId, cwd, command });
        } else {
          console.log('[DEBUG][TerminalPane] 复用已存在的 PTY session');
        }

        // Check mount state after PTY creation
        if (!mountState.isMounted) {
          console.log('[DEBUG][TerminalPane] initPty 取消 - 组件已卸载 (after create)');
          return;
        }

        // Resize PTY to match terminal dimensions (ignore if session already exited)
        await invoke("pty_resize", {
          id: sessionId,
          cols: term.cols,
          rows: term.rows,
        }).catch(() => {});

        onReadyRef.current?.();
      } catch (err) {
        if (mountState.isMounted) {
          console.error("Failed to initialize PTY:", err);
          term.writeln(`\r\n\x1b[31mFailed to create terminal: ${err}\x1b[0m`);
        }
      }
    };

    // Handle user input
    const onDataDisposable = term.onData((data) => {
      console.log('[DEBUG] onData:', JSON.stringify(data), 'length:', data.length);
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
      if (event.payload.id === sessionId && mountState.isMounted && terminalRef.current) {
        const bytes = new Uint8Array(event.payload.data);
        const text = new TextDecoder().decode(bytes);
        terminalRef.current.write(text);
      }
    });

    // Listen for PTY exit events
    const unlistenExit = listen<PtyExitEvent>("pty-exit", (event) => {
      if (event.payload.id === sessionId && mountState.isMounted) {
        onExitRef.current?.();
      }
    });

    initPty();

    // Cleanup - DO NOT kill PTY session on unmount (allows process to survive tab switches)
    // PTY is killed explicitly via handlePanelClose or handlePanelReload in WorkspaceView
    return () => {
      console.log('[DEBUG][TerminalPane] cleanup 触发, ptyId:', ptyId, 'sessionId:', sessionId);
      mountState.isMounted = false;
      onDataDisposable.dispose();
      onTitleDisposable.dispose();

      // Unlisten events
      unlistenData.then((fn) => fn());
      unlistenExit.then((fn) => fn());

      // Dispose terminal UI only, keep PTY alive
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [ptyId]); // Only re-run when ptyId changes (reload), not cwd/command

  // Handle resize
  const handleResize = useCallback(() => {
    if (!fitAddonRef.current || !terminalRef.current) return;

    fitAddonRef.current.fit();

    const { cols, rows } = terminalRef.current;
    invoke("pty_resize", { id: sessionIdRef.current, cols, rows }).catch(console.error);
  }, []);

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

  // Focus terminal on click
  const handleClick = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full bg-[#1a1a1a] ${className}`}
      onClick={handleClick}
    />
  );
}

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
  onReady,
  onExit,
  onTitleChange,
  className = "",
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Initialize terminal and PTY
  useEffect(() => {
    if (!containerRef.current) return;

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

    // Fit terminal to container
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Track cleanup state
    let isMounted = true;

    // Create PTY session
    const initPty = async () => {
      try {
        await invoke("pty_create", { id: ptyId, cwd });

        // Resize PTY to match terminal dimensions
        await invoke("pty_resize", {
          id: ptyId,
          cols: term.cols,
          rows: term.rows,
        });

        onReady?.();
      } catch (err) {
        console.error("Failed to create PTY:", err);
        term.writeln(`\r\n\x1b[31mFailed to create terminal: ${err}\x1b[0m`);
      }
    };

    // Handle user input
    const onDataDisposable = term.onData((data) => {
      const encoder = new TextEncoder();
      const bytes = Array.from(encoder.encode(data));
      invoke("pty_write", { id: ptyId, data: bytes }).catch(console.error);
    });

    // Handle title changes
    const onTitleDisposable = term.onTitleChange((title) => {
      onTitleChange?.(title);
    });

    // Listen for PTY data events
    const unlistenData = listen<PtyDataEvent>("pty-data", (event) => {
      if (event.payload.id === ptyId && isMounted && terminalRef.current) {
        const bytes = new Uint8Array(event.payload.data);
        const text = new TextDecoder().decode(bytes);
        terminalRef.current.write(text);
      }
    });

    // Listen for PTY exit events
    const unlistenExit = listen<PtyExitEvent>("pty-exit", (event) => {
      if (event.payload.id === ptyId && isMounted) {
        onExit?.();
      }
    });

    initPty();

    // Cleanup
    return () => {
      isMounted = false;
      onDataDisposable.dispose();
      onTitleDisposable.dispose();

      // Unlisten events
      unlistenData.then((fn) => fn());
      unlistenExit.then((fn) => fn());

      // Kill PTY session
      invoke("pty_kill", { id: ptyId }).catch(() => {});

      // Dispose terminal
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [ptyId, cwd, onReady, onExit, onTitleChange]);

  // Handle resize
  const handleResize = useCallback(() => {
    if (!fitAddonRef.current || !terminalRef.current) return;

    fitAddonRef.current.fit();

    const { cols, rows } = terminalRef.current;
    invoke("pty_resize", { id: ptyId, cols, rows }).catch(console.error);
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

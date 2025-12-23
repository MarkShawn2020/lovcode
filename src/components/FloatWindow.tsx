import { useState, useEffect, useRef, useCallback } from "react";
// Lucide icons (no Radix equivalent)
import { Trash2 } from "lucide-react";
// Radix icons
import { Cross2Icon, CheckIcon } from "@radix-ui/react-icons";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";

// ============================================================================
// LovcodeLogo - App Logo 组件
// ============================================================================

function LovcodeLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="-127 -80 1240 1240" className={className} fill="currentColor">
      <path d="M281.73,892.18V281.73C281.73,126.13,155.6,0,0,0l0,0v610.44C0,766.04,126.13,892.18,281.73,892.18z"/>
      <path d="M633.91,1080V469.56c0-155.6-126.13-281.73-281.73-281.73l0,0v610.44C352.14,953.87,478.31,1080,633.91,1080L633.91,1080z"/>
      <path d="M704.32,91.16L704.32,91.16v563.47l0,0c155.6,0,281.73-126.13,281.73-281.73S859.92,91.16,704.32,91.16z"/>
    </svg>
  );
}

// ============================================================================
// MiniSwitch - 小型开关组件
// ============================================================================

function MiniSwitch({ checked, onChange, label }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className="flex items-center gap-1.5 text-xs"
      title={label}
    >
      <div
        className={`relative w-7 h-4 rounded-full transition-colors ${
          checked ? "bg-white/40" : "bg-white/15"
        }`}
      >
        <div
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </div>
      {label && <span className="opacity-70">{label}</span>}
    </button>
  );
}

// ============================================================================
// Types
// ============================================================================

export interface ReviewItem {
  id: string;
  seq: number;  // Global auto-increment sequence number
  title: string;
  project?: string;
  timestamp: number;
  // tmux navigation context
  tmux_session?: string;
  tmux_window?: string;
  tmux_pane?: string;
  // Claude session reference
  session_id?: string;
  project_path?: string;
}

// ============================================================================
// FloatWindow Component
// ============================================================================

// 磁吸阈值（px）
const SNAP_THRESHOLD = 240;

// 持久化存储 key
const STORAGE_KEY = "lovnotifier-float-window";

interface FloatWindowState {
  x: number;
  y: number;
  isExpanded: boolean;
  snapSide: "left" | "right" | null;
  expandDirection: "left" | "right";
}

function loadState(): Partial<FloatWindowState> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveState(state: Partial<FloatWindowState>) {
  try {
    const current = loadState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {
    console.error("Failed to save float window state:", e);
  }
}

export function FloatWindow() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [completedItems, setCompletedItems] = useState<ReviewItem[]>([]);
  const [completedHasMore, setCompletedHasMore] = useState(true);
  const [completedOffset, setCompletedOffset] = useState(0);
  const [showOnlyPending, setShowOnlyPending] = useState(true);
  const savedState = loadState();
  const [isExpanded, setIsExpanded] = useState(savedState.isExpanded ?? false);
  const [expandDirection, setExpandDirection] = useState<"left" | "right">(savedState.expandDirection ?? "right");
  const [snapSide, setSnapSide] = useState<"left" | "right" | null>(savedState.snapSide ?? null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const isDraggingRef = useRef(false);
  const initializedRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 20;

  // 修复无焦点时 hover 效果不工作的问题
  // macOS WebKit 在非焦点窗口中不触发 mousemove 事件
  // 解决方案：轮询全局鼠标位置，手动计算 hover 状态
  useEffect(() => {
    let lastCursor = "default";
    let lastHoveredItem: string | null = null;
    let lastHoverTarget: HTMLElement | null = null;
    let lastHoverGroup: HTMLElement | null = null;
    let intervalId: number | null = null;
    let inFlight = false;
    type CursorInWindow = { supported: boolean; in_window: boolean; x: number; y: number };

    const getBoundsCandidates = async () => {
      const candidates: Array<{ x: number; y: number; width: number; height: number }> = [];
      const domBounds = {
        x: window.screenX,
        y: window.screenY,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      if (
        Number.isFinite(domBounds.x) &&
        Number.isFinite(domBounds.y) &&
        domBounds.width > 0 &&
        domBounds.height > 0
      ) {
        candidates.push(domBounds);
      }

      try {
        const win = getCurrentWindow();
        const scale = await win.scaleFactor();
        const windowPos = (await win.innerPosition()).toLogical(scale);
        const windowSize = (await win.innerSize()).toLogical(scale);
        candidates.push({
          x: windowPos.x,
          y: windowPos.y,
          width: windowSize.width,
          height: windowSize.height,
        });
      } catch {
        // ignore errors
      }

      return candidates;
    };

    const getFallbackRelPos = async () => {
      const [rawCursorX, rawCursorY] = await invoke<[number, number]>("get_cursor_position");
      const scale = window.devicePixelRatio || 1;
      const cursorCandidates = [
        { x: rawCursorX, y: rawCursorY },
        { x: rawCursorX / scale, y: rawCursorY / scale },
      ];
      const boundsCandidates = await getBoundsCandidates();

      let relX = 0;
      let relY = 0;
      let isInWindow = false;
      for (const bounds of boundsCandidates) {
        for (const cursor of cursorCandidates) {
          const rx = cursor.x - bounds.x;
          const ry = cursor.y - bounds.y;
          if (rx >= 0 && rx <= bounds.width && ry >= 0 && ry <= bounds.height) {
            relX = rx;
            relY = ry;
            isInWindow = true;
            break;
          }
        }
        if (isInWindow) break;
      }

      return { relX, relY, isInWindow };
    };

    const checkCursorPosition = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        let relX: number | null = null;
        let relY: number | null = null;
        let isInWindow = false;
        let nativeSupported = false;

        try {
          const nativePos = await invoke<CursorInWindow>("get_cursor_position_in_window", {
            label: "float",
          });
          if (nativePos?.supported) {
            nativeSupported = true;
            if (nativePos.in_window) {
              relX = nativePos.x;
              relY = nativePos.y;
              isInWindow = true;
            }
          }
        } catch {
          // ignore errors
        }

        if (!nativeSupported) {
          const fallback = await getFallbackRelPos();
          relX = fallback.relX;
          relY = fallback.relY;
          isInWindow = fallback.isInWindow;
        }

        if (isInWindow && relX !== null && relY !== null) {
          // 使用 document.elementFromPoint 获取鼠标下的元素
          const element = document.elementFromPoint(relX, relY) as HTMLElement | null;
          let itemElement = element?.closest('[data-item-id]') as HTMLElement | null;
          let itemId = itemElement?.dataset.itemId ?? null;

          if (!itemId) {
            // Fallback for unfocused WebKit: manual hit-test by rects.
            const itemElements = document.querySelectorAll<HTMLElement>('[data-item-id]');
            for (const candidate of itemElements) {
              const rect = candidate.getBoundingClientRect();
              if (relX >= rect.left && relX <= rect.right && relY >= rect.top && relY <= rect.bottom) {
                itemId = candidate.dataset.itemId ?? null;
                itemElement = candidate;
                break;
              }
            }
          }

          const hoverTarget = element?.closest<HTMLElement>(
            '[data-hover-target], [data-item-id], button, [role="button"], a, .cursor-pointer'
          ) ?? itemElement ?? null;
          const hoverGroup = hoverTarget?.closest<HTMLElement>('.group') ?? null;

          if (hoverTarget !== lastHoverTarget) {
            if (lastHoverTarget) {
              lastHoverTarget.removeAttribute("data-sim-hover");
            }
            if (hoverTarget) {
              hoverTarget.setAttribute("data-sim-hover", "true");
            }
            lastHoverTarget = hoverTarget;
          }
          if (hoverGroup !== lastHoverGroup) {
            if (lastHoverGroup) {
              lastHoverGroup.removeAttribute("data-sim-hover");
            }
            if (hoverGroup) {
              hoverGroup.setAttribute("data-sim-hover", "true");
            }
            lastHoverGroup = hoverGroup;
          }

          if (itemId !== lastHoveredItem) {
            lastHoveredItem = itemId;
            setHoveredId(itemId);
          }

          // 设置光标
          const isClickable = hoverTarget !== null || itemId !== null;
          const newCursor = isClickable ? "pointer" : "default";

          if (newCursor !== lastCursor) {
            lastCursor = newCursor;
            invoke("set_cursor", { cursorType: newCursor });
          }
        } else {
          // 鼠标离开窗口
          if (lastHoverTarget) {
            lastHoverTarget.removeAttribute("data-sim-hover");
            lastHoverTarget = null;
          }
          if (lastHoverGroup) {
            lastHoverGroup.removeAttribute("data-sim-hover");
            lastHoverGroup = null;
          }
          if (lastHoveredItem !== null) {
            lastHoveredItem = null;
            setHoveredId(null);
          }
          if (lastCursor !== "default") {
            lastCursor = "default";
            invoke("set_cursor", { cursorType: "default" });
          }
        }
      } catch {
        // ignore errors
      } finally {
        inFlight = false;
      }
    };

    // 开始轮询（非焦点窗口可能暂停 rAF）
    intervalId = window.setInterval(checkCursorPosition, 50);
    checkCursorPosition();

    return () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    };
  }, []);

  // 磁吸到边缘
  const snapToEdge = async () => {
    const win = getCurrentWindow();
    const monitor = await currentMonitor();
    if (!monitor) return;

    const pos = await win.outerPosition();
    const outerSize = await win.outerSize();
    const innerSize = await win.innerSize();
    const scale = monitor.scaleFactor;

    console.log("DEBUG sizes:", {
      outer: outerSize.width / scale,
      inner: innerSize.width / scale,
      diff: (outerSize.width - innerSize.width) / scale,
    });

    // 转换为逻辑坐标
    const monitorX = monitor.position.x / scale;
    const monitorWidth = monitor.size.width / scale;
    const windowX = pos.x / scale;
    const windowY = pos.y / scale;
    // 使用 innerSize（可见内容区域）
    const windowWidth = innerSize.width / scale;

    let newX = windowX;
    let snappedSide: "left" | "right" | null = null;

    // 左边磁吸
    if (windowX - monitorX < SNAP_THRESHOLD) {
      newX = monitorX;
      snappedSide = "left";
    }
    // 右边磁吸
    else if (monitorX + monitorWidth - windowX - windowWidth < SNAP_THRESHOLD) {
      newX = monitorX + monitorWidth - windowWidth;
      snappedSide = "right";
    }

    setSnapSide(snappedSide);
    saveState({ snapSide: snappedSide });

    if (snappedSide !== null) {
      console.log("DEBUG before setPosition:", { newX, windowY, targetRight: newX + windowWidth, monitorRight: monitorX + monitorWidth });
      await win.setPosition(new LogicalPosition(newX, windowY));
      saveState({ x: newX, y: windowY });
      const posAfter = await win.outerPosition();
      console.log("DEBUG after setPosition:", { actualX: posAfter.x / scale, actualRight: posAfter.x / scale + windowWidth });
    } else {
      // 未磁吸时也保存位置
      saveState({ x: windowX, y: windowY });
    }
  };

  // 监听鼠标松开事件，拖拽结束后磁吸
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        // 延迟确保 Tauri startDragging 完全结束
        setTimeout(() => {
          snapToEdge();
        }, 50);
      }
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, []);

  // 加载已完成消息
  const loadCompletedItems = useCallback(async (reset = false) => {
    const offset = reset ? 0 : completedOffset;
    try {
      const items = await invoke<ReviewItem[]>("get_completed_queue", {
        limit: PAGE_SIZE,
        offset,
      });
      if (reset) {
        setCompletedItems(items);
        setCompletedOffset(PAGE_SIZE);
      } else {
        setCompletedItems(prev => [...prev, ...items]);
        setCompletedOffset(offset + PAGE_SIZE);
      }
      setCompletedHasMore(items.length === PAGE_SIZE);
    } catch (e) {
      console.error("Failed to load completed queue:", e);
    }
  }, [completedOffset]);

  // 组件挂载时拉取当前队列，并监听后续更新
  useEffect(() => {
    invoke<ReviewItem[]>("get_review_queue").then(setItems).catch(console.error);
    loadCompletedItems(true);

    const unlisten = listen<ReviewItem[]>("review-queue-update", (event) => {
      setItems(event.payload);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // 当关闭 showOnlyPending 时加载已完成消息
  useEffect(() => {
    if (!showOnlyPending) {
      loadCompletedItems(true);
    }
  }, [showOnlyPending]);

  // 当前显示的列表：pending only 或全部（pending + completed 按时间排序）
  const displayItems = showOnlyPending
    ? items
    : [...items, ...completedItems].sort((a, b) => b.timestamp - a.timestamp);

  // 虚拟滚动配置
  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 56, // 预估每个 item 高度
    overscan: 5,
  });

  // 计算收起状态的宽度（仅徽章）
  const getCollapsedWidth = () => {
    const paddingX = 12;
    const badgeSize = 24;
    return paddingX * 2 + badgeSize;
  };

  // 初始化窗口大小和位置
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initWindow = async () => {
      const win = getCurrentWindow();
      const saved = loadState();

      // 设置窗口大小（根据保存的展开状态）
      if (saved.isExpanded) {
        await win.setSize(new LogicalSize(280, 320));
      } else {
        await win.setSize(new LogicalSize(getCollapsedWidth(), 48));
      }

      // 恢复保存的位置
      if (saved.x !== undefined && saved.y !== undefined) {
        await win.setPosition(new LogicalPosition(saved.x, saved.y));
      }
    };
    initWindow();
  }, []);

  // Navigate to tmux pane and dismiss item
  const handleItemClick = async (item: ReviewItem) => {
    console.log('[DEBUG][FloatWindow] handleItemClick 入口:', {
      id: item.id,
      title: item.title,
      tmux_session: item.tmux_session,
      tmux_window: item.tmux_window,
      tmux_pane: item.tmux_pane,
    });

    const hasTmuxContext = item.tmux_session && item.tmux_window && item.tmux_pane;
    console.log('[DEBUG][FloatWindow] hasTmuxContext:', hasTmuxContext);

    if (hasTmuxContext) {
      console.log('[DEBUG][FloatWindow] 调用 navigate_to_tmux_pane...');
      try {
        const result = await invoke("navigate_to_tmux_pane", {
          session: item.tmux_session,
          window: item.tmux_window,
          pane: item.tmux_pane,
        });
        console.log('[DEBUG][FloatWindow] navigate_to_tmux_pane 成功:', result);
      } catch (e) {
        console.error('[DEBUG][FloatWindow] navigate_to_tmux_pane 失败:', e);
      }
    } else {
      console.log('[DEBUG][FloatWindow] 跳过导航 - 缺少 tmux 上下文');
    }

    console.log('[DEBUG][FloatWindow] 调用 handleDismiss:', item.id);
    handleDismiss(item.id);
  };

  // 消耗最早的消息（复用 handleItemClick 逻辑）
  const consumeOldestMessage = useCallback(() => {
    if (items.length > 0) {
      const oldest = [...items].sort((a, b) => a.timestamp - b.timestamp)[0];
      handleItemClick(oldest);
    }
  }, [items]);

  // 拖拽 + 点击判断
  const handleMouseDown = (e: React.MouseEvent) => {
    const isRightClick = e.button === 2;
    const startX = e.clientX;
    const startY = e.clientY;
    let isDragging = false;

    const handleMouseMove = async (moveEvent: MouseEvent) => {
      const dx = Math.abs(moveEvent.clientX - startX);
      const dy = Math.abs(moveEvent.clientY - startY);

      // 移动超过5px才算拖拽
      if (!isDragging && (dx > 5 || dy > 5)) {
        isDragging = true;
        isDraggingRef.current = true;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);

        const win = getCurrentWindow();
        await win.startDragging();
      }
    };

    const handleMouseUp = async () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      // 没有拖拽，视为点击
      if (!isDragging) {
        // 折叠模式下：左键消耗消息，右键展开
        if (!isExpanded && !isRightClick) {
          if (items.length > 0) {
            consumeOldestMessage();
          } else {
            // 无消息时抖动提示
            setShake(true);
            setTimeout(() => setShake(false), 300);
          }
          return;
        }
        const win = getCurrentWindow();
        const pos = await win.outerPosition();

        const expandedWidth = 280;
        const expandedHeight = 320;
        const collapsedHeight = 48;
        const collapsedWidth = getCollapsedWidth();

        const scale = window.devicePixelRatio;
        const windowX = pos.x / scale;
        const windowY = pos.y / scale;

        if (!isExpanded) {
          // 展开：先调整窗口大小，再改状态（避免圆角突变）
          const screenLeft = (window.screen as { availLeft?: number }).availLeft ?? 0;
          const screenTop = (window.screen as { availTop?: number }).availTop ?? 0;
          const screenWidth = window.screen.availWidth;
          const screenHeight = window.screen.availHeight;

          let newX = windowX;
          let newY = windowY;
          let newExpandDirection: "left" | "right" = "right";

          // 水平方向检测
          if (windowX + expandedWidth > screenLeft + screenWidth) {
            newExpandDirection = "left";
            newX = windowX - (expandedWidth - collapsedWidth);
            newX = Math.max(screenLeft, newX);
          }

          // 垂直方向检测：如果底部会超出，向上调整
          if (windowY + expandedHeight > screenTop + screenHeight) {
            newY = screenTop + screenHeight - expandedHeight;
            newY = Math.max(screenTop, newY);
          }

          setExpandDirection(newExpandDirection);
          if (newX !== windowX || newY !== windowY) {
            await win.setPosition(new LogicalPosition(newX, newY));
          }
          await win.setSize(new LogicalSize(expandedWidth, expandedHeight));
          setIsExpanded(true);
          saveState({ isExpanded: true, expandDirection: newExpandDirection, x: newX, y: newY });
        } else {
          // 收起：先改状态，再调整窗口大小
          setIsExpanded(false);
          let newX = windowX;
          if (expandDirection === "left") {
            newX = windowX + (expandedWidth - collapsedWidth);
            await win.setPosition(new LogicalPosition(newX, windowY));
          }
          await win.setSize(new LogicalSize(collapsedWidth, collapsedHeight));
          saveState({ isExpanded: false, x: newX, y: windowY });
        }
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleDismiss = async (id: string) => {
    // 先乐观更新 UI
    setItems(prev => prev.filter(item => item.id !== id));
    // 调用后端（会持久化到 completed queue）
    try {
      await invoke("dismiss_review_item", { id });
      // 刷新 completed 列表
      loadCompletedItems(true);
    } catch (e) {
      console.error("Failed to dismiss item:", e);
    }
  };

  const handleClearCompleted = async () => {
    try {
      await invoke("clear_completed_queue");
      setCompletedItems([]);
      setCompletedOffset(0);
      setCompletedHasMore(false);
    } catch (e) {
      console.error("Failed to clear completed queue:", e);
    }
  };

  // 无限滚动：当滚动到底部时加载更多（仅在显示全部时）
  const handleScroll = useCallback(() => {
    if (!listRef.current || showOnlyPending || !completedHasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    if (scrollHeight - scrollTop - clientHeight < 100) {
      loadCompletedItems(false);
    }
  }, [showOnlyPending, completedHasMore, loadCompletedItems]);

  const formatTime = (timestamp: number) => {
    // timestamp 从后端来的是秒，Date.now() 是毫秒
    const diff = Date.now() - timestamp * 1000;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // 收缩时的圆角样式
  const collapsedRounding = snapSide === "left"
    ? "rounded-r-full" // 靠左边，右边圆
    : snapSide === "right"
    ? "rounded-l-full" // 靠右边，左边圆
    : "rounded-full";  // 未吸附，全圆

  const uiRef = useRef<HTMLDivElement>(null);

  // 调试：打印 UI 实际宽度
  useEffect(() => {
    if (uiRef.current) {
      const rect = uiRef.current.getBoundingClientRect();
      console.log("DEBUG UI actual size:", { width: rect.width, height: rect.height, calculatedWidth: isExpanded ? 280 : getCollapsedWidth() });
    }
  }, [isExpanded]);

  return (
    <div
      ref={uiRef}
      className={`w-screen h-screen bg-primary text-primary-foreground overflow-hidden flex flex-col ${isExpanded ? "rounded-xl" : collapsedRounding}`}
    >
        {/* Header - click to toggle, drag to move */}
        {/* Collapsed: left click = consume oldest, right click = expand */}
        <div
          className={`flex items-center gap-2 cursor-pointer select-none shrink-0 ${isExpanded ? "justify-center p-3" : "px-3 py-2 h-full"}`}
          onMouseDown={handleMouseDown}
          onContextMenu={(e) => e.preventDefault()}
        >
          {isExpanded ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 flex-1"
            >
              <LovcodeLogo className="w-5 h-5 shrink-0" />
              <span className="font-medium text-sm flex-1">Lovcode Messages</span>
              <MiniSwitch
                checked={showOnlyPending}
                onChange={setShowOnlyPending}
              />
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  getCurrentWindow().hide();
                }}
                className="p-1 hover:bg-white/20 rounded transition-colors"
              >
                <Cross2Icon className="w-4 h-4" />
              </button>
            </motion.div>
          ) : (
            <motion.span
              className="w-6 h-6 flex items-center justify-center text-xs font-bold bg-white/20 rounded-full"
              animate={shake ? { x: [-2, 2, -2, 2, 0] } : {}}
              transition={{ duration: 0.3 }}
            >
              {items.length}
            </motion.span>
          )}
        </div>

        {/* Expanded content */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="px-3 pb-3 overflow-hidden flex flex-col"
            >
              {/* 状态栏 */}
              <div className="flex items-center gap-1 mb-2 text-xs opacity-80">
                <span>
                  {showOnlyPending
                    ? `${items.length} pending`
                    : `${items.length} pending · ${completedItems.length}${completedHasMore ? "+" : ""} done`}
                </span>
                {!showOnlyPending && completedItems.length > 0 && (
                  <button
                    onClick={handleClearCompleted}
                    className="ml-auto p-1 text-white/40 hover:text-white/80 transition-colors"
                    title="Clear completed"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Virtualized Items list */}
              <div
                ref={listRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto"
                style={{ maxHeight: 200 }}
              >
                {displayItems.length > 0 ? (
                  <div
                    style={{
                      height: `${virtualizer.getTotalSize()}px`,
                      width: "100%",
                      position: "relative",
                    }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const item = displayItems[virtualRow.index];
                      const isHovered = hoveredId === item.id;
                      const isCompleted = completedItems.some(c => c.id === item.id);
                      return (
                        <div
                          key={item.id}
                          data-item-id={item.id}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                          className="py-1"
                        >
                          <div
                            onClick={() => !isCompleted && handleItemClick(item)}
                            className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                              isCompleted ? "cursor-default" : "cursor-pointer"
                            } ${isHovered ? "bg-white/20" : "bg-white/10"} ${
                              isCompleted ? "opacity-70" : ""
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${isCompleted ? "line-through opacity-70" : ""}`}>
                                {item.title}
                                {item.tmux_window && (
                                  <span className="text-xs opacity-60 font-normal ml-1">
                                    ({item.tmux_window}, {item.tmux_pane})
                                  </span>
                                )}
                              </p>
                              <p className="text-xs opacity-70 truncate">
                                #{item.seq} · {formatTime(item.timestamp)}
                              </p>
                            </div>
                            {!isCompleted && (
                              <motion.button
                                whileTap={{ scale: 0.9 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDismiss(item.id);
                                }}
                                className={`p-1 rounded transition-opacity ${
                                  isHovered ? "opacity-100 bg-white/10" : "opacity-0"
                                }`}
                              >
                                <Cross2Icon className="w-3.5 h-3.5" />
                              </motion.button>
                            )}
                            {isCompleted && (
                              <CheckIcon className="w-4 h-4 text-primary-foreground/70" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-4 text-sm opacity-70">
                    {showOnlyPending ? "No pending reviews" : "No messages"}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
    </div>
  );
}

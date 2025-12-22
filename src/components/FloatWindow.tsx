import { useState, useEffect, useRef } from "react";
import { ClipboardList, X, Terminal } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { motion, AnimatePresence } from "framer-motion";

// ============================================================================
// Types
// ============================================================================

export interface ReviewItem {
  id: string;
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
  const savedState = loadState();
  const [isExpanded, setIsExpanded] = useState(savedState.isExpanded ?? false);
  const [expandDirection, setExpandDirection] = useState<"left" | "right">(savedState.expandDirection ?? "right");
  const [snapSide, setSnapSide] = useState<"left" | "right" | null>(savedState.snapSide ?? null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  const initializedRef = useRef(false);


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

  // 组件挂载时拉取当前队列，并监听后续更新
  useEffect(() => {
    // 拉取当前队列（热刷新后恢复数据）
    invoke<ReviewItem[]>("get_review_queue").then((queue) => {
      if (queue.length === 0) {
        // 添加示例消息供测试
        setItems([{
          id: "example-1",
          title: "✓ Example Project",
          project: "example",
          timestamp: Math.floor(Date.now() / 1000),
          tmux_session: "main",
          tmux_window: "1",
          tmux_pane: "0",
        }]);
      } else {
        setItems(queue);
      }
    }).catch(console.error);

    // 监听后续更新
    const unlisten = listen<ReviewItem[]>("review-queue-update", (event) => {
      setItems(event.payload);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // 计算收起状态的宽度
  const getCollapsedWidth = () => {
    const paddingX = 12;
    const badgeSize = 24;
    const gap = 8;
    const brandName = "Lovnotifier";
    const charWidth = 7;
    return Math.ceil(paddingX * 2 + badgeSize + gap + brandName.length * charWidth);
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

  // 拖拽 + 点击判断
  const handleMouseDown = (e: React.MouseEvent) => {
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
          const screenLeft = window.screen.availLeft ?? 0;
          const screenTop = window.screen.availTop ?? 0;
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

  const handleDismiss = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

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
        <div
          className={`flex items-center gap-2 cursor-pointer select-none shrink-0 ${isExpanded ? "justify-center p-3" : "px-3 py-2 h-full"}`}
          onMouseDown={handleMouseDown}
        >
          {isExpanded ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 flex-1"
            >
              <ClipboardList className="w-5 h-5 shrink-0" />
              <span className="font-medium text-sm flex-1">Lovnotifier Messages</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  getCurrentWindow().hide();
                }}
                className="p-1 hover:bg-white/20 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ) : (
            <div className={`flex items-center w-full ${snapSide === "right" ? "flex-row-reverse" : ""}`}>
              <span className="text-xs tracking-wide opacity-90 flex-1 px-1">Lovnotifier</span>
              <span className="w-6 h-6 flex items-center justify-center text-xs font-bold bg-white/20 rounded-full shrink-0">
                {items.length}
              </span>
            </div>
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
              className="px-3 pb-3 overflow-hidden"
            >
              <div className="flex items-center justify-between mb-2 text-xs opacity-80">
                <span>{items.length} pending</span>
              </div>

              {/* Items list */}
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {items.map((item, index) => {
                  const isHovered = hoveredId === item.id;
                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      onClick={() => handleItemClick(item)}
                      onMouseEnter={() => setHoveredId(item.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className={`flex items-center gap-2 p-2 rounded-lg transition-colors cursor-pointer ${
                        isHovered ? "bg-white/20" : "bg-white/10"
                      }`}
                    >
                      {/* tmux indicator */}
                      {item.tmux_session && (
                        <Terminal className="w-4 h-4 shrink-0 opacity-70" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.title}</p>
                        <p className="text-xs opacity-70 truncate">
                          {item.tmux_session && (
                            <span>{item.tmux_session}:{item.tmux_window}.{item.tmux_pane} · </span>
                          )}
                          {formatTime(item.timestamp)}
                        </p>
                      </div>
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
                        <X className="w-3.5 h-3.5" />
                      </motion.button>
                    </motion.div>
                  );
                })}
              </div>

              {items.length === 0 && (
                <div className="text-center py-4 text-sm opacity-70">
                  No pending reviews
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
    </div>
  );
}

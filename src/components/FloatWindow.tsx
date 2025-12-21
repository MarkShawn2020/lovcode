import { useState, useEffect, useRef } from "react";
import { ClipboardList, X, GripVertical } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
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
}

// ============================================================================
// FloatWindow Component
// ============================================================================

// 磁吸阈值（px）
const SNAP_THRESHOLD = 240;

export function FloatWindow() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandDirection, setExpandDirection] = useState<"left" | "right">("right");
  const isDraggingRef = useRef(false);

  // 磁吸到边缘
  const snapToEdge = async () => {
    const win = getCurrentWindow();
    const monitor = await currentMonitor();
    if (!monitor) return;

    const pos = await win.outerPosition();
    const size = await win.outerSize();
    const scaleFactor = monitor.scaleFactor;

    const screenWidth = monitor.size.width / scaleFactor;
    const screenHeight = monitor.size.height / scaleFactor;
    const windowX = pos.x / scaleFactor;
    const windowY = pos.y / scaleFactor;
    const windowWidth = size.width / scaleFactor;
    const windowHeight = size.height / scaleFactor;

    let newX = windowX;
    let newY = windowY;
    let snapped = false;

    // 左边磁吸
    if (windowX < SNAP_THRESHOLD) {
      newX = 0;
      snapped = true;
    }
    // 右边磁吸
    else if (screenWidth - (windowX + windowWidth) < SNAP_THRESHOLD) {
      newX = screenWidth - windowWidth;
      snapped = true;
    }

    // 上边磁吸
    if (windowY < SNAP_THRESHOLD) {
      newY = 0;
      snapped = true;
    }
    // 下边磁吸
    else if (screenHeight - (windowY + windowHeight) < SNAP_THRESHOLD) {
      newY = screenHeight - windowHeight;
      snapped = true;
    }

    if (snapped) {
      await win.setPosition(new LogicalPosition(newX, newY));
    }
  };

  // 监听鼠标松开事件，拖拽结束后磁吸
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        // 延迟一帧确保窗口位置已更新
        requestAnimationFrame(() => {
          snapToEdge();
        });
      }
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, []);

  // 监听后端推送
  useEffect(() => {
    const unlisten = listen<ReviewItem[]>("review-queue-update", (event) => {
      setItems(event.payload);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Demo数据
  useEffect(() => {
    setItems([
      { id: "1", title: "Fix login validation bug", project: "auth-service", timestamp: Date.now() - 300000 },
      { id: "2", title: "Add dark mode toggle", project: "frontend", timestamp: Date.now() - 600000 },
      { id: "3", title: "Update API documentation", project: "backend", timestamp: Date.now() - 900000 },
    ]);
  }, []);

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
        const monitor = await currentMonitor();

        const expandedWidth = 280;
        const collapsedWidth = 48;
        const height = 320;

        if (!isExpanded) {
          // 展开
          if (monitor) {
            const scaleFactor = monitor.scaleFactor;
            const screenWidth = monitor.size.width / scaleFactor;
            const windowX = pos.x / scaleFactor;
            const windowY = pos.y / scaleFactor;

            if (windowX + expandedWidth > screenWidth) {
              // 向左展开：窗口左移
              setExpandDirection("left");
              const newX = windowX - (expandedWidth - collapsedWidth);
              await win.setPosition(new LogicalPosition(Math.max(0, newX), windowY));
            } else {
              setExpandDirection("right");
            }
          }
          await win.setSize(new LogicalSize(expandedWidth, height));
        } else {
          // 收起
          if (expandDirection === "left") {
            // 向左展开的，收起时窗口右移回来
            const scaleFactor = monitor?.scaleFactor || 1;
            const windowX = pos.x / scaleFactor;
            const windowY = pos.y / scaleFactor;
            await win.setPosition(new LogicalPosition(windowX + (expandedWidth - collapsedWidth), windowY));
          }
          await win.setSize(new LogicalSize(collapsedWidth, height));
        }

        setIsExpanded(prev => !prev);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleDismiss = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="w-full h-full">
      <div className="w-full h-full bg-primary text-primary-foreground rounded-xl shadow-2xl overflow-hidden">
        {/* Header - click to toggle, drag to move */}
        <div
          className="flex items-center gap-2 p-3 cursor-pointer select-none"
          onMouseDown={handleMouseDown}
        >
          <motion.div
            className="relative shrink-0 flex items-center justify-center w-6 h-6"
            whileTap={{ scale: 0.9 }}
          >
            <ClipboardList className="w-5 h-5" />
            <AnimatePresence>
              {items.length > 0 && !isExpanded && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="absolute -top-2 -right-2 bg-white text-primary text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center shadow"
                >
                  {items.length}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2 flex-1"
              >
                <span className="font-medium text-sm flex-1">Review Queue</span>
                <GripVertical className="w-4 h-4 opacity-50" />
              </motion.div>
            )}
          </AnimatePresence>
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
                {items.map((item, index) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="group flex items-center gap-2 p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      <p className="text-xs opacity-70 truncate">
                        {item.project && <span>{item.project} · </span>}
                        {formatTime(item.timestamp)}
                      </p>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleDismiss(item.id)}
                      className="p-1 opacity-0 group-hover:opacity-100 hover:bg-white/20 rounded transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" />
                    </motion.button>
                  </motion.div>
                ))}
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
    </div>
  );
}

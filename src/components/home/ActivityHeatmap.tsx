import { useMemo, useRef, useEffect, useState } from "react";

type ViewMode = "weekday" | "hour";

interface ActivityHeatmapProps {
  /** Map of date (YYYY-MM-DD) to count */
  daily: Record<string, number>;
  /** Map of "date:hour" (YYYY-MM-DD:HH) to count */
  detailed: Record<string, number>;
}

export function ActivityHeatmap({ daily, detailed }: ActivityHeatmapProps) {
  const [mode, setMode] = useState<ViewMode>("weekday");
  const scrollRef = useRef<HTMLDivElement>(null);

  const dailyMap = useMemo(() => new Map(Object.entries(daily)), [daily]);
  const detailedMap = useMemo(() => new Map(Object.entries(detailed)), [detailed]);

  // Weekday mode data (existing logic)
  const weekdayData = useMemo(() => {
    const today = new Date();
    const cells: { date: string; count: number; dayOfWeek: number }[] = [];
    const weeksToShow = 52;
    const daysToShow = weeksToShow * 7;

    for (let i = daysToShow - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      cells.push({
        date: dateStr,
        count: dailyMap.get(dateStr) || 0,
        dayOfWeek: d.getDay(),
      });
    }

    const weeks: typeof cells[] = [];
    let currentWeek: typeof cells = [];
    const firstDayOfWeek = cells[0]?.dayOfWeek || 0;
    for (let i = 0; i < firstDayOfWeek; i++) {
      currentWeek.push({ date: "", count: 0, dayOfWeek: i });
    }

    cells.forEach((cell) => {
      if (cell.dayOfWeek === 0 && currentWeek.length > 0) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      currentWeek.push(cell);
    });
    if (currentWeek.length > 0) weeks.push(currentWeek);

    const monthLabels: { month: string; weekIdx: number }[] = [];
    let lastMonth = -1;
    weeks.forEach((week, weekIdx) => {
      const firstValidCell = week.find((c) => c.date);
      if (firstValidCell) {
        const month = new Date(firstValidCell.date).getMonth();
        if (month !== lastMonth) {
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          monthLabels.push({ month: monthNames[month], weekIdx });
          lastMonth = month;
        }
      }
    });

    const maxCount = Math.max(...cells.map((c) => c.count), 1);
    const totalSessions = cells.reduce((sum, c) => sum + c.count, 0);

    return { weeks, maxCount, totalSessions, monthLabels };
  }, [dailyMap]);

  // Hour mode data (横轴日期，纵轴0-23小时)
  const hourData = useMemo(() => {
    const today = new Date();
    const daysToShow = 90; // 3 months for hour view
    const days: { date: string; hours: number[] }[] = [];

    for (let i = daysToShow - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const hours: number[] = [];
      for (let h = 0; h < 24; h++) {
        const key = `${dateStr}:${h.toString().padStart(2, "0")}`;
        hours.push(detailedMap.get(key) || 0);
      }
      days.push({ date: dateStr, hours });
    }

    // Month labels for hour view
    const monthLabels: { month: string; dayIdx: number }[] = [];
    let lastMonth = -1;
    days.forEach((day, dayIdx) => {
      const month = new Date(day.date).getMonth();
      if (month !== lastMonth) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        monthLabels.push({ month: monthNames[month], dayIdx });
        lastMonth = month;
      }
    });

    const allCounts = days.flatMap((d) => d.hours);
    const maxCount = Math.max(...allCounts, 1);
    const totalSessions = allCounts.reduce((sum, c) => sum + c, 0);

    return { days, maxCount, totalSessions, monthLabels };
  }, [detailedMap]);

  // Scroll to right on mount/mode change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [mode, weekdayData, hourData]);

  const getColorClass = (count: number, maxCount: number): string => {
    if (count === 0) return "bg-muted/30";
    const ratio = count / maxCount;
    if (ratio < 0.25) return "bg-primary/20";
    if (ratio < 0.5) return "bg-primary/40";
    if (ratio < 0.75) return "bg-primary/70";
    return "bg-primary";
  };

  const cellSize = 11;
  const cellGap = 3;
  const weekLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hourLabels = ["0", "3", "6", "9", "12", "15", "18", "21"];

  const totalSessions = mode === "weekday" ? weekdayData.totalSessions : hourData.totalSessions;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            Activity
          </span>
          {/* Mode toggle */}
          <div className="flex rounded-md border border-border/60 overflow-hidden">
            <button
              onClick={() => setMode("weekday")}
              className={`px-2 py-0.5 text-[10px] transition-colors ${
                mode === "weekday"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-accent"
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setMode("hour")}
              className={`px-2 py-0.5 text-[10px] transition-colors ${
                mode === "hour"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-accent"
              }`}
            >
              Hour
            </button>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">
          {totalSessions.toLocaleString()} chats
        </span>
      </div>

      <div className="flex gap-1">
        {/* Y-axis labels */}
        <div className="flex flex-col gap-[3px] text-[10px] text-muted-foreground/70 pr-1 pt-4">
          {mode === "weekday"
            ? weekLabels.map((label, i) => (
                <div key={i} className="h-[11px] flex items-center">
                  {i % 2 === 1 ? label : ""}
                </div>
              ))
            : Array.from({ length: 24 }, (_, i) => (
                <div key={i} className="h-[11px] flex items-center justify-end pr-1">
                  {hourLabels.includes(i.toString()) ? `${i}h` : ""}
                </div>
              ))}
        </div>

        {/* Scrollable heatmap */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
        >
          {mode === "weekday" ? (
            <>
              {/* Month labels */}
              <div className="flex h-4 mb-1" style={{ gap: `${cellGap}px` }}>
                {weekdayData.weeks.map((_, weekIdx) => {
                  const label = weekdayData.monthLabels.find((m) => m.weekIdx === weekIdx);
                  return (
                    <div
                      key={weekIdx}
                      className="text-[10px] text-muted-foreground/70"
                      style={{ width: `${cellSize}px`, flexShrink: 0 }}
                    >
                      {label?.month || ""}
                    </div>
                  );
                })}
              </div>
              {/* Grid */}
              <div className="flex" style={{ gap: `${cellGap}px` }}>
                {weekdayData.weeks.map((week, weekIdx) => (
                  <div key={weekIdx} className="flex flex-col" style={{ gap: `${cellGap}px` }}>
                    {week.map((cell, dayIdx) => (
                      <div
                        key={dayIdx}
                        className={`rounded-sm cursor-default ${
                          cell.date ? getColorClass(cell.count, weekdayData.maxCount) : "bg-transparent"
                        }`}
                        style={{ width: `${cellSize}px`, height: `${cellSize}px` }}
                        title={cell.date ? `${cell.date}: ${cell.count} chats` : ""}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Month labels for hour view */}
              <div className="flex h-4 mb-1" style={{ gap: `${cellGap}px` }}>
                {hourData.days.map((_, dayIdx) => {
                  const label = hourData.monthLabels.find((m) => m.dayIdx === dayIdx);
                  return (
                    <div
                      key={dayIdx}
                      className="text-[10px] text-muted-foreground/70"
                      style={{ width: `${cellSize}px`, flexShrink: 0 }}
                    >
                      {label?.month || ""}
                    </div>
                  );
                })}
              </div>
              {/* Grid: each column is a day, each row is an hour */}
              <div className="flex" style={{ gap: `${cellGap}px` }}>
                {hourData.days.map((day, dayIdx) => (
                  <div key={dayIdx} className="flex flex-col" style={{ gap: `${cellGap}px` }}>
                    {day.hours.map((count, hourIdx) => (
                      <div
                        key={hourIdx}
                        className={`rounded-sm cursor-default ${getColorClass(count, hourData.maxCount)}`}
                        style={{ width: `${cellSize}px`, height: `${cellSize}px` }}
                        title={`${day.date} ${hourIdx}:00 - ${count} chats`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground/70">
        <span>Less</span>
        <div className="w-[11px] h-[11px] rounded-sm bg-muted/30" />
        <div className="w-[11px] h-[11px] rounded-sm bg-primary/20" />
        <div className="w-[11px] h-[11px] rounded-sm bg-primary/40" />
        <div className="w-[11px] h-[11px] rounded-sm bg-primary/70" />
        <div className="w-[11px] h-[11px] rounded-sm bg-primary" />
        <span>More</span>
      </div>
    </div>
  );
}

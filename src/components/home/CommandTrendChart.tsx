import { useMemo, useState } from "react";
import { useAtom } from "jotai";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { commandRangeAtom, commandModeAtom } from "@/store";

interface CommandTrendChartProps {
  /** Map of command_name -> { week_key -> count } */
  data: Record<string, Record<string, number>>;
}

// Color palette for commands
const COLORS = [
  "#CC785C", // primary (陶土色)
  "#D4896D",
  "#DC9A7E",
  "#B86A4E",
  "#5B8A72", // 绿
  "#4A7B9D", // 蓝
  "#8B7355", // 棕
  "#7D6B8A", // 紫
];

const MAX_COMMANDS = 8;

interface HoverData {
  label: string;
  items: { name: string; value: number; color: string }[];
}

// Get ISO week number
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

type TimeRange = "1m" | "3m" | "all";

const RANGE_WEEKS: Record<TimeRange, number | null> = {
  "1m": 5,   // ~1 month
  "3m": 13,  // ~3 months
  "all": null,
};

export function CommandTrendChart({ data }: CommandTrendChartProps) {
  const [hoverData, setHoverData] = useState<HoverData | null>(null);
  const [mode, setMode] = useAtom(commandModeAtom);
  const [range, setRange] = useAtom(commandRangeAtom);

  const { chartData, commands, totalCommands } = useMemo(() => {
    // Generate week keys based on range
    const weekKeys: string[] = [];
    const rangeWeeks = RANGE_WEEKS[range];

    if (rangeWeeks === null) {
      // "all" mode: extract all unique weeks from data, sorted
      const allWeeks = new Set<string>();
      Object.values(data).forEach(weekData => {
        Object.keys(weekData).forEach(w => allWeeks.add(w));
      });
      weekKeys.push(...Array.from(allWeeks).sort());
    } else {
      // Fixed range: generate week keys for the last N weeks
      const now = new Date();
      for (let i = rangeWeeks - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i * 7);
        const { year, week } = getISOWeek(d);
        weekKeys.push(`${year}-W${week.toString().padStart(2, "0")}`);
      }
    }

    // Get all commands and sort by total usage within the selected range
    const weekKeySet = new Set(weekKeys);
    const commandTotals: [string, number][] = Object.entries(data).map(([cmd, weekData]) => [
      cmd,
      Object.entries(weekData)
        .filter(([w]) => weekKeySet.has(w))
        .reduce((sum, [, count]) => sum + count, 0),
    ]);
    commandTotals.sort((a, b) => b[1] - a[1]);
    const totalCommands = commandTotals.length;
    // Only take top N commands for display
    const commands = commandTotals.slice(0, MAX_COMMANDS).map(([cmd]) => cmd);

    // Build chart data based on mode
    // In weekly mode, exclude the current (incomplete) week
    const weeksToRender = mode === "weekly" ? weekKeys.slice(0, -1) : weekKeys;

    const chartData = weeksToRender.map((week, idx) => {
      const point: Record<string, string | number> = {
        week: week.replace(/^\d{4}-W/, "W"),
      };

      if (mode === "cumulative") {
        // Cumulative: sum all weeks up to this point
        commands.forEach((cmd) => {
          let cumulative = 0;
          for (let i = 0; i <= idx; i++) {
            cumulative += data[cmd]?.[weeksToRender[i]] || 0;
          }
          point[cmd] = cumulative;
        });
      } else {
        // Weekly: show each week's data
        commands.forEach((cmd) => {
          point[cmd] = data[cmd]?.[week] || 0;
        });
      }
      return point;
    });

    return { chartData, commands, totalCommands };
  }, [data, range, mode]);

  if (commands.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        No command usage data
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            Command Trends
          </span>
          {/* Time range toggle */}
          <div className="flex rounded-md border border-border/60 overflow-hidden">
            {(["1m", "3m", "all"] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2 py-0.5 text-[10px] transition-colors ${
                  range === r
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-accent"
                }`}
              >
                {r === "1m" ? "1M" : r === "3m" ? "3M" : "All"}
              </button>
            ))}
          </div>
          {/* Mode toggle */}
          <div className="flex rounded-md border border-border/60 overflow-hidden">
            <button
              onClick={() => setMode("weekly")}
              className={`px-2 py-0.5 text-[10px] transition-colors ${
                mode === "weekly"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-accent"
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => setMode("cumulative")}
              className={`px-2 py-0.5 text-[10px] transition-colors ${
                mode === "cumulative"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-accent"
              }`}
            >
              Cumulative
            </button>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">
          Top {commands.length} of {totalCommands}
        </span>
      </div>

      {/* Chart */}
      <div className="h-36 w-full min-w-0">
        <ResponsiveContainer width="100%" height={144} minWidth={0}>
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 5, bottom: 5, left: -20 }}
            onMouseLeave={() => setHoverData(null)}
          >
            <XAxis
              dataKey="week"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length > 0) {
                  const newData: HoverData = {
                    label: label as string,
                    items: payload.map((p) => ({
                      name: p.name as string,
                      value: (p.value as number) ?? 0,
                      color: (p.color as string) || "#999",
                    })),
                  };
                  // Use setTimeout to avoid setState during render
                  setTimeout(() => setHoverData(newData), 0);
                }
                return null; // Don't render tooltip
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "10px", paddingTop: "8px" }}
              iconSize={8}
            />
            {commands.map((cmd, i) => (
              <Line
                key={cmd}
                type="monotone"
                dataKey={cmd}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Details below chart */}
      <div className="min-h-[60px] pt-2 border-t border-border/40">
        {hoverData ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-sm font-medium w-full mb-1">{hoverData.label}</span>
            {[...hoverData.items].sort((a, b) => b.value - a.value).map((entry, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-muted-foreground">{entry.name}:</span>
                <span className="font-medium">{entry.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">
            Hover chart to see week details
          </div>
        )}
      </div>
    </div>
  );
}

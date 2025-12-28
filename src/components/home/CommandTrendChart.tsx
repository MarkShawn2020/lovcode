import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface CommandTrendChartProps {
  /** Map of command_name -> { week_key -> count } */
  data: Record<string, Record<string, number>>;
  weeks?: number;
}

// Color palette for commands (using primary variations)
const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--primary) / 0.7)",
  "hsl(var(--primary) / 0.5)",
  "hsl(25, 50%, 55%)",
  "hsl(25, 40%, 65%)",
  "hsl(25, 30%, 75%)",
  "hsl(200, 40%, 55%)",
  "hsl(160, 40%, 50%)",
];

const MAX_COMMANDS = 8; // Only show top N commands in chart

export function CommandTrendChart({ data, weeks = 12 }: CommandTrendChartProps) {
  const { chartData, commands, totalCommands } = useMemo(() => {
    // Collect all week keys from the actual data
    const weekKeySet = new Set<string>();
    Object.values(data).forEach((weekData) => {
      Object.keys(weekData).forEach((week) => weekKeySet.add(week));
    });

    // Sort week keys chronologically and take last N weeks
    const allWeekKeys = Array.from(weekKeySet).sort();
    const weekKeys = allWeekKeys.slice(-weeks);

    // Get all commands and sort by total usage
    const commandTotals: [string, number][] = Object.entries(data).map(([cmd, weekData]) => [
      cmd,
      Object.values(weekData).reduce((sum, count) => sum + count, 0),
    ]);
    commandTotals.sort((a, b) => b[1] - a[1]);
    const totalCommands = commandTotals.length;
    // Only take top N commands for display
    const commands = commandTotals.slice(0, MAX_COMMANDS).map(([cmd]) => cmd);

    // Build chart data
    const chartData = weekKeys.map((week) => {
      const point: Record<string, string | number> = { week: week.replace(/^\d{4}-W/, "W") };
      commands.forEach((cmd) => {
        point[cmd] = data[cmd]?.[week] || 0;
      });
      return point;
    });

    return { chartData, commands, totalCommands };
  }, [data, weeks]);

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
        <span className="text-xs text-muted-foreground uppercase tracking-wide">
          Command Trends
        </span>
        <span className="text-xs text-muted-foreground">
          Top {commands.length} of {totalCommands}
        </span>
      </div>

      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
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
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
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
    </div>
  );
}

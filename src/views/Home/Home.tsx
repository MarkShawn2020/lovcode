import { useMemo } from "react";
import type { FeatureType, Project, Session, LocalCommand } from "../../types";
import { FEATURES, FEATURE_ICONS } from "../../constants";
import { ActivityHeatmap, RecentActivity, QuickActions, CommandTrendChart } from "../../components/home";
import { useInvokeQuery } from "../../hooks";

interface HomeProps {
  onFeatureClick: (feature: FeatureType) => void;
  onProjectClick: (project: Project) => void;
  onSessionClick: (session: Session) => void;
  onSearch: () => void;
}

interface ActivityStats {
  daily: Record<string, number>;
  hourly: Record<string, number>;
  detailed: Record<string, number>;
}

export function Home({ onFeatureClick, onProjectClick, onSessionClick, onSearch }: HomeProps) {
  const { data: projects } = useInvokeQuery<Project[]>(["projects"], "list_projects");
  const { data: sessions } = useInvokeQuery<Session[]>(["sessions"], "list_all_sessions");
  const { data: commands } = useInvokeQuery<LocalCommand[]>(["commands"], "list_local_commands");
  const { data: activityStats } = useInvokeQuery<ActivityStats>(["activityStats"], "get_activity_stats");
  const { data: commandWeeklyStats } = useInvokeQuery<Record<string, Record<string, number>>>(
    ["commandWeeklyStats"],
    "get_command_weekly_stats",
    { weeks: 0 }  // 0 = all time, filtering done in CommandTrendChart
  );

  const data = projects && sessions && commands ? { projects, sessions, commands } : null;


  // Get last active project
  const lastProject = useMemo(() => {
    if (!data || data.projects.length === 0) return null;
    return data.projects.reduce((latest, p) =>
      p.last_active > latest.last_active ? p : latest
    );
  }, [data]);

  // Stats
  const stats = useMemo(() => {
    if (!data) return null;
    const totalMessages = data.sessions.reduce((sum, s) => sum + s.message_count, 0);
    return {
      projects: data.projects.length,
      sessions: data.sessions.length,
      commands: data.commands.length,
      messages: totalMessages,
    };
  }, [data]);

  return (
    <div className="flex flex-col min-h-full px-6 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="font-serif text-4xl font-bold text-primary mb-2 tracking-tight flex items-center justify-center gap-3">
          <img src="/logo.png" alt="Lovcode" className="w-10 h-10" />
          Lovcode
        </h1>
        <p className="text-muted-foreground">Your Vibe Coding Hub</p>
      </div>

      {/* Quick Actions */}
      <div className="flex justify-center mb-8">
        <QuickActions
          lastProject={lastProject}
          onContinue={onProjectClick}
          onSearch={onSearch}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 max-w-4xl mx-auto w-full space-y-6">
        {/* Activity Heatmap + Stats */}
        {data && (
          <div className="bg-card/50 rounded-2xl p-5 border border-border/40">
            {activityStats && (
              <ActivityHeatmap
                daily={activityStats.daily}
                detailed={activityStats.detailed}
              />
            )}
            {/* Command Trend Chart */}
            {commandWeeklyStats && Object.keys(commandWeeklyStats).length > 0 && (
              <div className="mt-4 pt-4 border-t border-border/40">
                <CommandTrendChart data={commandWeeklyStats} />
              </div>
            )}
            {/* Inline Stats */}
            {stats && (
              <div className="flex items-center gap-6 mt-4 pt-4 border-t border-border/40 text-sm text-muted-foreground">
                <span>
                  <strong className="text-foreground font-serif">{stats.projects}</strong> workspaces
                </span>
                <span>
                  <strong className="text-foreground font-serif">{stats.sessions}</strong> sessions
                </span>
                <span>
                  <strong className="text-foreground font-serif">{stats.commands}</strong> commands
                </span>
              </div>
            )}
          </div>
        )}

        {/* Two Column: Recent Activity + Features */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Recent Activity */}
          <div className="bg-card/50 rounded-2xl p-5 border border-border/40">
            <h2 className="text-xs text-muted-foreground uppercase tracking-wide mb-3">
              Recent Activity
            </h2>
            {data && (
              <RecentActivity
                projects={data.projects}
                sessions={data.sessions}
                onProjectClick={onProjectClick}
                onSessionClick={onSessionClick}
              />
            )}
          </div>

          {/* Feature Grid */}
          <div className="bg-card/50 rounded-2xl p-5 border border-border/40">
            <h2 className="text-xs text-muted-foreground uppercase tracking-wide mb-3">
              Features
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {FEATURES.map((feature) => {
                const Icon = FEATURE_ICONS[feature.type];
                return (
                  <button
                    key={feature.type}
                    onClick={() => onFeatureClick(feature.type)}
                    className={`flex items-center gap-2 p-3 rounded-xl border transition-all duration-200 ${
                      feature.available
                        ? "bg-background border-border/60 hover:border-primary hover:shadow-sm cursor-pointer"
                        : "bg-muted/30 border-transparent cursor-default"
                    }`}
                    disabled={!feature.available}
                  >
                    {Icon && (
                      <Icon
                        className={`w-5 h-5 ${
                          feature.available ? "text-primary/80" : "text-muted-foreground/50"
                        }`}
                      />
                    )}
                    <span
                      className={`text-sm ${
                        feature.available ? "text-foreground" : "text-muted-foreground/60"
                      }`}
                    >
                      {feature.label}
                    </span>
                    {!feature.available && (
                      <span className="text-[10px] text-muted-foreground/50 italic ml-auto">
                        Soon
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

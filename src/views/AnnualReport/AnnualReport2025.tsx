import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Cross2Icon, ChevronDownIcon, DownloadIcon } from "@radix-ui/react-icons";
import { domToCanvas } from "modern-screenshot";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { AnnualReport2025 as AnnualReportData } from "../../types";
import { useInvokeQuery } from "../../hooks";

interface AnnualReport2025Props {
  onClose: () => void;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getHourLabel(hour: number): string {
  if (hour >= 0 && hour < 6) return "Late Night";
  if (hour >= 6 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 18) return "Afternoon";
  if (hour >= 18 && hour < 21) return "Evening";
  return "Night";
}

// Screen Components
function TitleScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <div className="text-8xl font-serif font-bold bg-gradient-to-r from-primary via-amber-500 to-primary bg-clip-text text-transparent mb-4">
          2025
        </div>
      </motion.div>
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <h1 className="font-serif text-3xl font-semibold text-foreground mb-2">
          Your Year with Claude Code
        </h1>
        <p className="text-muted-foreground">
          Let's look back at your coding journey
        </p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-12 flex items-center gap-2 text-muted-foreground text-sm"
      >
        <span>Scroll to continue</span>
        <ChevronDownIcon className="w-4 h-4 animate-bounce" />
      </motion.div>
    </div>
  );
}

function OverviewScreen({ report }: { report: AnnualReportData }) {
  const stats = [
    { label: "Conversations", value: report.total_sessions, suffix: "" },
    { label: "Messages", value: report.total_messages, suffix: "" },
    { label: "Active Days", value: report.active_days, suffix: "days" },
    { label: "Projects", value: report.total_projects, suffix: "" },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <motion.h2
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-serif text-2xl font-semibold text-foreground mb-8"
      >
        Your 2025 Overview
      </motion.h2>

      <div className="grid grid-cols-2 gap-6 max-w-md">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
            className="bg-card/80 rounded-2xl p-6 text-center border border-border/40"
          >
            <div className="text-4xl font-bold text-primary font-serif mb-1">
              {stat.value.toLocaleString()}
            </div>
            <div className="text-sm text-muted-foreground">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {report.first_chat_date && report.last_chat_date && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 text-center text-muted-foreground text-sm"
        >
          <p>
            From <span className="text-foreground font-medium">{report.first_chat_date}</span>
            {" "}to{" "}
            <span className="text-foreground font-medium">{report.last_chat_date}</span>
          </p>
        </motion.div>
      )}
    </div>
  );
}

function ActivityScreen({ report }: { report: AnnualReportData }) {
  const peakHourLabel = getHourLabel(report.peak_hour);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <motion.h2
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-serif text-2xl font-semibold text-foreground mb-8"
      >
        When You Code Best
      </motion.h2>

      <div className="flex flex-col gap-6 max-w-md w-full">
        {/* Peak Hour */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-r from-primary/10 to-amber-500/10 rounded-2xl p-6 border border-primary/20"
        >
          <div className="text-sm text-muted-foreground mb-2">Peak Hour</div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-bold text-primary font-serif">
              {report.peak_hour}:00
            </span>
            <span className="text-lg text-foreground">{peakHourLabel}</span>
          </div>
          <div className="text-sm text-muted-foreground mt-2">
            {report.peak_hour_count} sessions at this hour
          </div>
        </motion.div>

        {/* Peak Weekday */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card/80 rounded-2xl p-6 border border-border/40"
        >
          <div className="text-sm text-muted-foreground mb-2">Most Active Day</div>
          <div className="text-3xl font-bold text-foreground font-serif">
            {WEEKDAY_NAMES[report.peak_weekday]}
          </div>
        </motion.div>

        {/* Longest Streak */}
        {report.longest_streak > 1 && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-card/80 rounded-2xl p-6 border border-border/40"
          >
            <div className="text-sm text-muted-foreground mb-2">Longest Streak</div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-primary font-serif">
                {report.longest_streak}
              </span>
              <span className="text-lg text-foreground">consecutive days</span>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function ProjectsScreen({ report }: { report: AnnualReportData }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <motion.h2
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-serif text-2xl font-semibold text-foreground mb-8"
      >
        Your Favorite Project
      </motion.h2>

      {report.favorite_project ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-br from-primary/10 via-card to-amber-500/10 rounded-2xl p-8 border border-primary/20 max-w-md w-full"
        >
          <div className="text-sm text-muted-foreground mb-2">Most Used</div>
          <div className="font-serif text-xl font-semibold text-foreground mb-4">
            {getProjectName(report.favorite_project.path)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-3xl font-bold text-primary font-serif">
                {report.favorite_project.session_count}
              </div>
              <div className="text-sm text-muted-foreground">sessions</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary font-serif">
                {report.favorite_project.message_count.toLocaleString()}
              </div>
              <div className="text-sm text-muted-foreground">messages</div>
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-muted-foreground text-center"
        >
          <p>No project data available for 2025</p>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-6 text-center"
      >
        <p className="text-muted-foreground text-sm">
          You worked on <span className="text-foreground font-medium">{report.total_projects}</span> projects in 2025
        </p>
      </motion.div>
    </div>
  );
}

function CommandsScreen({ report }: { report: AnnualReportData }) {
  const maxCount = report.top_commands[0]?.count || 1;

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <motion.h2
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-serif text-2xl font-semibold text-foreground mb-8"
      >
        Your Top Commands
      </motion.h2>

      {report.top_commands.length > 0 ? (
        <div className="max-w-md w-full space-y-3">
          {report.top_commands.map((cmd, i) => (
            <motion.div
              key={cmd.name}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="relative"
            >
              <div
                className="absolute inset-0 bg-primary/10 rounded-xl"
                style={{ width: `${(cmd.count / maxCount) * 100}%` }}
              />
              <div className="relative flex items-center justify-between p-4">
                <span className="font-mono text-sm text-foreground">{cmd.name}</span>
                <span className="text-sm text-muted-foreground">{cmd.count}x</span>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-muted-foreground text-center"
        >
          <p>No command data available</p>
        </motion.div>
      )}
    </div>
  );
}

function SummaryScreen({
  report,
  onShareZh,
  onShareEn,
  sharing,
}: {
  report: AnnualReportData;
  onShareZh: () => void;
  onShareEn: () => void;
  sharing: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <motion.h2
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-serif text-2xl font-semibold text-foreground mb-8"
      >
        What a Year!
      </motion.h2>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
        className="bg-card/80 rounded-2xl p-8 border border-border/40 max-w-md w-full text-center"
      >
        <p className="text-lg text-foreground mb-6">
          In 2025, you had{" "}
          <span className="font-bold text-primary">{report.total_sessions}</span>{" "}
          conversations with Claude Code, exchanging{" "}
          <span className="font-bold text-primary">{report.total_messages.toLocaleString()}</span>{" "}
          messages across{" "}
          <span className="font-bold text-primary">{report.total_projects}</span>{" "}
          projects.
        </p>

        {report.longest_streak > 1 && (
          <p className="text-muted-foreground mb-6">
            Your longest coding streak was{" "}
            <span className="text-foreground font-medium">{report.longest_streak} days</span>!
          </p>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={onShareZh}
            disabled={sharing}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <DownloadIcon className="w-4 h-4" />
            {sharing ? "Generating..." : "Save as Image (中文)"}
          </button>
          <button
            onClick={onShareEn}
            disabled={sharing}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-card border border-border text-foreground rounded-xl font-medium hover:bg-card/80 transition-colors disabled:opacity-50"
          >
            <DownloadIcon className="w-4 h-4" />
            {sharing ? "Generating..." : "Save as Image (English)"}
          </button>
        </div>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-8 text-muted-foreground text-sm"
      >
        Here's to an even better 2026!
      </motion.p>
    </div>
  );
}

// Helper to convert string to Title Case
function toTitleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Helper to get short project name from path
// Handles: "/Users/mark/projects/lovcode" or "-Users-mark-projects-lovcode"
function getProjectName(path: string): string {
  let name: string;
  // Handle dash-separated format (like "-Users-mark-projects-lovcode")
  if (path.startsWith("-") || !path.includes("/")) {
    const parts = path.split("-").filter(Boolean);
    name = parts[parts.length - 1] || path;
  } else {
    // Handle normal path format
    const parts = path.split("/").filter(Boolean);
    name = parts[parts.length - 1] || path;
  }
  return toTitleCase(name);
}

// Helper to extract username from path
function getUserName(path: string): string {
  // Handle dash-separated format
  if (path.startsWith("-") || !path.includes("/")) {
    const parts = path.split("-").filter(Boolean);
    // Format: Users-mark-projects-xxx -> mark is at index 1
    if (parts[0]?.toLowerCase() === "users" && parts[1]) {
      return parts[1];
    }
  }
  // Handle normal path format: /Users/mark/... -> mark
  const parts = path.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() === "users" && parts[1]) {
    return parts[1];
  }
  return "Coder";
}

// Shareable Card Component (hidden, used for screenshot)
// Uses inline styles because Tailwind classes won't be captured by screenshot
// Design inspired by NetEase Cloud Music annual report - premium festival style
function ShareableCard({ report, language = "zh" }: { report: AnnualReportData; language?: "zh" | "en" }) {
  const peakHourLabel = getHourLabel(report.peak_hour);
  const projectName = report.favorite_project ? getProjectName(report.favorite_project.path) : "";
  const userName = report.favorite_project ? getUserName(report.favorite_project.path) : "Coder";

  // Translations
  const t = {
    title: language === "zh" ? "2025 Vibe Coding 年度报告" : "2025 Vibe Coding Annual Report",
    statsPeriod: language === "zh" ? "统计周期" : "Period",
    conversations: language === "zh" ? "对话" : "Conversations",
    conversationsUnit: language === "zh" ? "次" : "",
    messages: language === "zh" ? "消息" : "Messages",
    messagesUnit: language === "zh" ? "条" : "",
    commands: language === "zh" ? "命令" : "Commands",
    commandsUnit: language === "zh" ? "个" : "",
    activeDays: language === "zh" ? "活跃" : "Active Days",
    activeDaysUnit: language === "zh" ? "天" : "",
    projects: language === "zh" ? "项目" : "Projects",
    projectsUnit: language === "zh" ? "个" : "",
    streak: language === "zh" ? "连续" : "Streak",
    streakUnit: language === "zh" ? "天" : " days",
    favoriteProject: language === "zh" ? "年度最爱项目" : "Favorite Project",
    peakTime: language === "zh" ? "活跃时段" : "Peak Hour",
    peakDay: language === "zh" ? "活跃日" : "Active Day",
    mostCoding: language === "zh" ? "最常编程" : "Most Coding",
    topCommands: language === "zh" ? "🔥 年度常用命令" : "🔥 Top Commands",
    tagline: language === "zh" ? "Your Vibe Coding Hub" : "Your Vibe Coding Hub",
  };

  return (
    <div
      style={{
        width: 420,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        position: "relative",
        overflow: "hidden",
        background: "#C54B24",
      }}
    >
      {/* Phoenix Hero Background with title overlay */}
      <div
        style={{
          width: "100%",
          height: 300,
          backgroundImage: "url(/annual-report-phoenix.png)",
          backgroundSize: "cover",
          backgroundPosition: "center top",
          position: "relative",
        }}
      >
        {/* Gradient overlay at bottom for text readability */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 120,
            background: "linear-gradient(to top, rgba(197,75,36,0.95) 0%, rgba(197,75,36,0.7) 50%, transparent 100%)",
          }}
        />
        {/* Title at bottom of hero - above the content card */}
        <div
          style={{
            position: "absolute",
            bottom: 24,
            left: 0,
            right: 0,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "#FFFFFF",
              textShadow: "0 2px 8px rgba(0,0,0,0.4)",
              letterSpacing: "0.5px",
              marginBottom: 6,
            }}
          >
            {t.title}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.85)",
              fontWeight: 500,
            }}
          >
            @{userName}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div
        style={{
          background: "linear-gradient(180deg, #C54B24 0%, #B8421F 100%)",
          padding: "20px 20px 24px",
          position: "relative",
        }}
      >
        {/* Main Stats Card - Warm pink/cream gradient */}
        <div
          style={{
            background: "linear-gradient(160deg, #FFF8F5 0%, #FFE8DC 40%, #FFD4C4 100%)",
            borderRadius: 20,
            padding: 20,
            marginBottom: 20,
            boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          }}
        >
          {/* Stats Period Badge */}
          <div
            style={{
              textAlign: "center",
              marginBottom: 12,
              paddingBottom: 12,
              borderBottom: "1px solid rgba(216,90,42,0.1)",
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: "#AA7A6A",
                background: "rgba(216,90,42,0.08)",
                padding: "4px 12px",
                borderRadius: 10,
                fontWeight: 500,
              }}
            >
              {t.statsPeriod}{language === "zh" ? "：" : ": "}{report.first_chat_date || "2025.01"} - {report.last_chat_date || "2025.12"}
            </span>
          </div>

          {/* 3-column Core Stats Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
            }}
          >
            {/* Conversations */}
            <div style={{ textAlign: "center", padding: 10 }}>
              <div style={{ fontSize: 10, color: "#996B5B", marginBottom: 4, fontWeight: 600 }}>{t.conversations}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#D85A2A", lineHeight: 1 }}>
                {report.total_sessions.toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: "#AA7A6A", marginTop: 2 }}>{t.conversationsUnit}</div>
            </div>

            {/* Messages */}
            <div style={{ textAlign: "center", padding: 10 }}>
              <div style={{ fontSize: 10, color: "#996B5B", marginBottom: 4, fontWeight: 600 }}>{t.messages}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#E8734A", lineHeight: 1 }}>
                {report.total_messages.toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: "#AA7A6A", marginTop: 2 }}>{t.messagesUnit}</div>
            </div>

            {/* Commands */}
            <div style={{ textAlign: "center", padding: 10 }}>
              <div style={{ fontSize: 10, color: "#996B5B", marginBottom: 4, fontWeight: 600 }}>{t.commands}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#D85A2A", lineHeight: 1 }}>
                {report.total_commands.toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: "#AA7A6A", marginTop: 2 }}>{t.commandsUnit}</div>
            </div>

            {/* Active Days */}
            <div style={{ textAlign: "center", padding: 10 }}>
              <div style={{ fontSize: 10, color: "#996B5B", marginBottom: 4, fontWeight: 600 }}>{t.activeDays}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#E8734A", lineHeight: 1 }}>
                {report.active_days}
              </div>
              <div style={{ fontSize: 10, color: "#AA7A6A", marginTop: 2 }}>{t.activeDaysUnit}</div>
            </div>

            {/* Projects */}
            <div style={{ textAlign: "center", padding: 10 }}>
              <div style={{ fontSize: 10, color: "#996B5B", marginBottom: 4, fontWeight: 600 }}>{t.projects}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#D85A2A", lineHeight: 1 }}>
                {report.total_projects}
              </div>
              <div style={{ fontSize: 10, color: "#AA7A6A", marginTop: 2 }}>{t.projectsUnit}</div>
            </div>

            {/* Longest Streak */}
            <div style={{ textAlign: "center", padding: 10 }}>
              <div style={{ fontSize: 10, color: "#996B5B", marginBottom: 4, fontWeight: 600 }}>{t.streak}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#E8734A", lineHeight: 1 }}>
                {report.longest_streak}
              </div>
              <div style={{ fontSize: 10, color: "#AA7A6A", marginTop: 2 }}>{t.streakUnit}</div>
            </div>
          </div>

          {/* Favorite Project */}
          {report.favorite_project && (
            <div
              style={{
                marginTop: 16,
                padding: 14,
                background: "rgba(216,90,42,0.08)",
                borderRadius: 14,
                borderLeft: "4px solid #D85A2A",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    background: "linear-gradient(135deg, #D85A2A 0%, #E8734A 100%)",
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  🏆
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: "#996B5B", marginBottom: 2, fontWeight: 600 }}>{t.favoriteProject}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#4A3530" }}>
                    {projectName}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Section - Unified card with stats + commands */}
        <div
          style={{
            background: "rgba(0,0,0,0.15)",
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
          }}
        >
          {/* Secondary Stats Row - Peak Time Info */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              paddingBottom: 14,
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              marginBottom: 14,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 2 }}>{t.peakTime}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#FFFFFF", lineHeight: 1 }}>{report.peak_hour}:00</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{peakHourLabel}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 2 }}>{t.peakDay}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#FFFFFF", lineHeight: 1 }}>{WEEKDAY_NAMES[report.peak_weekday]}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{t.mostCoding}</div>
            </div>
          </div>

          {/* Top Commands */}
          {report.top_commands.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginBottom: 8, fontWeight: 500 }}>
                {t.topCommands}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {report.top_commands.slice(0, 4).map((cmd, i) => (
                  <div
                    key={cmd.name}
                    style={{
                      background: i === 0 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      padding: "4px 10px",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#FFFFFF",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
                      }}
                    >
                      {cmd.name}
                    </span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>×{cmd.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer - with QR code */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <img
              src="/logo.png"
              alt="Lovcode"
              style={{ width: 20, height: 20, borderRadius: 4 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#FFFFFF" }}>Lovcode</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>Your Vibe Coding Hub</div>
            </div>
          </div>
          <img
            src="/lovcode-qrcode.png"
            alt="QR Code"
            style={{ width: 48, height: 48, borderRadius: 4, background: "#FFFFFF", padding: 2 }}
          />
        </div>
      </div>
    </div>
  );
}

// Main Component
export function AnnualReport2025({ onClose }: AnnualReport2025Props) {
  const [currentScreen, setCurrentScreen] = useState(0);
  const [sharing, setSharing] = useState(false);
  const shareCardZhRef = useRef<HTMLDivElement>(null);
  const shareCardEnRef = useRef<HTMLDivElement>(null);

  const { data: report, isLoading } = useInvokeQuery<AnnualReportData>(
    ["annualReport2025"],
    "get_annual_report_2025"
  );

  const screens = [
    { id: "title", component: TitleScreen },
    { id: "overview", component: OverviewScreen },
    { id: "activity", component: ActivityScreen },
    { id: "projects", component: ProjectsScreen },
    { id: "commands", component: CommandsScreen },
    { id: "summary", component: SummaryScreen },
  ];

  const goNext = useCallback(() => {
    setCurrentScreen((prev) => Math.min(prev + 1, screens.length - 1));
  }, [screens.length]);

  const goPrev = useCallback(() => {
    setCurrentScreen((prev) => Math.max(prev - 1, 0));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev, onClose]);

  // Wheel navigation (debounced)
  const lastWheelTime = useRef(0);
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const now = Date.now();
      if (now - lastWheelTime.current < 500) return;
      lastWheelTime.current = now;

      if (e.deltaY > 0) {
        goNext();
      } else if (e.deltaY < 0) {
        goPrev();
      }
    },
    [goNext, goPrev]
  );

  // Share functionality - uses domToCanvas with Portal (no UI flicker)
  // Uses Tauri save dialog for proper file saving without Finder popup
  const handleShareImage = useCallback(async (language: "zh" | "en") => {
    const captureEl = language === "zh" ? shareCardZhRef.current : shareCardEnRef.current;
    if (!captureEl || !report) return;
    setSharing(true);

    try {
      // Get original dimensions (unaffected by any transform)
      const originalWidth = captureEl.scrollWidth;
      const originalHeight = captureEl.scrollHeight;

      // domToCanvas clones DOM in memory - no UI impact
      const canvas = await domToCanvas(captureEl, {
        scale: 2,
        backgroundColor: "#C54B24",
        width: originalWidth,
        height: originalHeight,
        style: {
          // Remove any hiding transforms on the cloned element
          transform: "none",
          visibility: "visible",
          opacity: "1",
        },
      });

      // Convert canvas to blob
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/png");
      });

      if (!blob) {
        throw new Error("Failed to create blob");
      }

      // Use Tauri save dialog with language-specific filename
      const path = await save({
        defaultPath: `lovcode-2025-report-${language}.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });

      if (path) {
        // Convert blob to Uint8Array
        const arrayBuffer = await blob.arrayBuffer();
        const data = Array.from(new Uint8Array(arrayBuffer));

        // Write file using Tauri command
        await invoke("write_binary_file", { path, data });

        // Reveal in Finder
        await revealItemInDir(path);
      }
    } catch (err) {
      console.error("Failed to generate image:", err);
    } finally {
      setSharing(false);
    }
  }, [report]);

  const handleShareZh = useCallback(() => handleShareImage("zh"), [handleShareImage]);
  const handleShareEn = useCallback(() => handleShareImage("en"), [handleShareImage]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center z-50">
        <div className="text-center">
          <div className="text-4xl font-serif font-bold text-primary mb-4">2025</div>
          <p className="text-muted-foreground">Loading your year...</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center z-50">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">No data available for 2025</p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
    <div
      className="fixed inset-0 bg-gradient-to-br from-background via-background to-primary/5 z-50 overflow-hidden"
      onWheel={handleWheel}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-card/80 border border-border/40 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Cross2Icon className="w-5 h-5" />
      </button>

      {/* Screen content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentScreen}
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          transition={{ duration: 0.3 }}
          className="h-full"
        >
          {currentScreen === 0 && <TitleScreen />}
          {currentScreen === 1 && <OverviewScreen report={report} />}
          {currentScreen === 2 && <ActivityScreen report={report} />}
          {currentScreen === 3 && <ProjectsScreen report={report} />}
          {currentScreen === 4 && <CommandsScreen report={report} />}
          {currentScreen === 5 && (
            <SummaryScreen report={report} onShareZh={handleShareZh} onShareEn={handleShareEn} sharing={sharing} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation dots */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2">
        {screens.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentScreen(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === currentScreen
                ? "bg-primary w-6"
                : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
          />
        ))}
      </div>

      </div>

      {/* Portal: ShareableCards rendered to body, hidden with transform */}
      {createPortal(
        <>
          <div
            ref={shareCardZhRef}
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              transform: "scale(0)",
              transformOrigin: "top left",
              pointerEvents: "none",
              zIndex: -1,
            }}
          >
            <ShareableCard report={report} language="zh" />
          </div>
          <div
            ref={shareCardEnRef}
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              transform: "scale(0)",
              transformOrigin: "top left",
              pointerEvents: "none",
              zIndex: -1,
            }}
          >
            <ShareableCard report={report} language="en" />
          </div>
        </>,
        document.body
      )}
    </>
  );
}

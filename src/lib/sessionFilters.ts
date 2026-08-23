import { projectLabel } from "./projectLabel.ts";
import type { Session } from "../types/index.ts";

export const ALL_PROJECTS_FILTER = "all";
export const ALL_SOURCES_FILTER = "all";

export type SessionSourceFilter = Session["source"] | typeof ALL_SOURCES_FILTER;

export const SESSION_SOURCE_LABELS: Record<Session["source"], string> = {
  "cli": "Claude Code",
  "app-code": "Claude App · Code",
  "app-web": "Claude Web",
  "app-cowork": "Claude App · Cowork",
  "codex": "Codex",
};

export interface SessionFilters {
  query: string;
  projectId: string;
  source: SessionSourceFilter;
}

export function filterSessions(
  sessions: Session[],
  filters: SessionFilters,
  getSearchTitle: (session: Session) => string = (session) => session.title ?? session.summary ?? session.last_prompt ?? "",
) {
  const needle = filters.query.trim().toLocaleLowerCase();

  return sessions.filter((session) => {
    if (filters.projectId !== ALL_PROJECTS_FILTER && session.project_id !== filters.projectId) {
      return false;
    }
    if (filters.source !== ALL_SOURCES_FILTER && session.source !== filters.source) {
      return false;
    }
    if (!needle) return true;

    const haystack = [
      getSearchTitle(session),
      session.title,
      session.summary,
      session.last_prompt,
      session.project_path,
      session.project_id,
      session.source,
      SESSION_SOURCE_LABELS[session.source],
    ].filter(Boolean).join("\n").toLocaleLowerCase();
    return haystack.includes(needle);
  });
}

export function getProjectFilterOptions(sessions: Session[]) {
  const projects = new Map<string, string>();
  sessions.forEach((session) => {
    if (!projects.has(session.project_id)) {
      projects.set(session.project_id, projectLabel(session.project_path, session.project_id));
    }
  });
  return Array.from(projects, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

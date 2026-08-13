import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { useSyncExternalStore } from "react";

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

export type AppUpdateStage =
  | "idle"
  | "unsupported"
  | "checking"
  | "latest"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "error";

export interface AppUpdateError {
  contextId: string;
  message: string;
  operation: "check" | "download" | "install" | "restart";
}

export interface AppUpdateState {
  stage: AppUpdateStage;
  currentVersion: string;
  availableVersion: string | null;
  notes: string | null;
  publishedAt: string | null;
  progress: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  lastCheckedAt: string | null;
  error: AppUpdateError | null;
  manual: boolean;
}

const initialState: AppUpdateState = {
  stage: isTauri() ? "idle" : "unsupported",
  currentVersion: "—",
  availableVersion: null,
  notes: null,
  publishedAt: null,
  progress: null,
  downloadedBytes: 0,
  totalBytes: null,
  lastCheckedAt: null,
  error: null,
  manual: false,
};

let state = initialState;
let activeUpdate: Update | null = null;
let checkInFlight: Promise<void> | null = null;
let installInFlight: Promise<void> | null = null;
let initialCheckStarted = false;
const listeners = new Set<() => void>();

function emit(next: AppUpdateState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function patch(next: Partial<AppUpdateState>) {
  emit({ ...state, ...next });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function cleanErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\/Users\/[^/\s]+\/[^\s]*/g, "<local-path>")
    .replace(/[?&](token|key|signature)=[^&\s]+/gi, "$1=<redacted>");
}

function createError(
  operation: AppUpdateError["operation"],
  error: unknown,
): AppUpdateError {
  return {
    contextId: `ataru-update-${Date.now().toString(36)}`,
    message: cleanErrorMessage(error),
    operation,
  };
}

async function loadCurrentVersion() {
  if (!isTauri()) return "—";
  if (state.currentVersion !== "—") return state.currentVersion;
  const currentVersion = await getVersion();
  patch({ currentVersion });
  return currentVersion;
}

export function useAppUpdater() {
  return useSyncExternalStore(subscribe, () => state, () => initialState);
}

export function getAppUpdateState() {
  return state;
}

export async function prepareAppUpdater() {
  if (!isTauri()) return;
  try {
    await loadCurrentVersion();
  } catch (error) {
    patch({
      stage: "error",
      error: createError("check", error),
      manual: false,
    });
  }
}

export function startInitialAppUpdateCheck() {
  if (initialCheckStarted || !isTauri()) return;
  initialCheckStarted = true;
  void checkForAppUpdate(false);
}

export function checkForAppUpdate(manual = true) {
  if (!isTauri()) {
    patch({ stage: "unsupported", manual });
    return Promise.resolve();
  }
  if (installInFlight) return installInFlight;
  if (checkInFlight) return checkInFlight;

  checkInFlight = (async () => {
    try {
      await loadCurrentVersion();
      patch({
        stage: "checking",
        progress: null,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
        manual,
      });

      if (activeUpdate) {
        await activeUpdate.close().catch(() => undefined);
        activeUpdate = null;
      }

      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      const lastCheckedAt = new Date().toISOString();
      if (!update) {
        patch({
          stage: "latest",
          availableVersion: null,
          notes: null,
          publishedAt: null,
          lastCheckedAt,
        });
        return;
      }

      activeUpdate = update;
      patch({
        stage: "available",
        currentVersion: update.currentVersion,
        availableVersion: update.version,
        notes: update.body ?? null,
        publishedAt: update.date ?? null,
        lastCheckedAt,
      });
    } catch (error) {
      patch({
        stage: "error",
        lastCheckedAt: new Date().toISOString(),
        error: createError("check", error),
      });
    }
  })().finally(() => {
    checkInFlight = null;
  });

  return checkInFlight;
}

function handleDownloadEvent(event: DownloadEvent) {
  if (event.event === "Started") {
    patch({
      stage: "downloading",
      downloadedBytes: 0,
      totalBytes: event.data.contentLength ?? null,
      progress: event.data.contentLength ? 0 : null,
    });
    return;
  }

  if (event.event === "Progress") {
    const downloadedBytes = state.downloadedBytes + event.data.chunkLength;
    const progress = state.totalBytes
      ? Math.min(100, Math.round((downloadedBytes / state.totalBytes) * 100))
      : null;
    patch({ downloadedBytes, progress });
    return;
  }

  patch({ stage: "installing", progress: 100 });
}

export function downloadAndInstallAppUpdate() {
  if (installInFlight) return installInFlight;
  if (!activeUpdate) {
    patch({
      stage: "error",
      error: createError("download", new Error("更新包状态已失效，请重新检查更新。")),
      manual: true,
    });
    return Promise.resolve();
  }

  installInFlight = (async () => {
    patch({
      stage: "downloading",
      progress: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      manual: true,
    });
    try {
      await activeUpdate.downloadAndInstall(handleDownloadEvent, {
        timeout: DOWNLOAD_TIMEOUT_MS,
      });
      patch({ stage: "ready", progress: 100 });
    } catch (error) {
      const operation = state.stage === "installing" ? "install" : "download";
      patch({
        stage: "error",
        error: createError(operation, error),
      });
    }
  })().finally(() => {
    installInFlight = null;
  });

  return installInFlight;
}

export async function restartToFinishAppUpdate() {
  try {
    await relaunch();
  } catch (error) {
    patch({
      stage: "error",
      error: createError("restart", error),
      manual: true,
    });
  }
}

export function formatAppUpdateDiagnostic(updateState = state) {
  if (!updateState.error) return "";
  return [
    `context_id: ${updateState.error.contextId}`,
    `operation: ${updateState.error.operation}`,
    `current_version: ${updateState.currentVersion}`,
    `available_version: ${updateState.availableVersion ?? "none"}`,
    `message: ${updateState.error.message}`,
  ].join("\n");
}

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { isTauri } from "@/lib/tauri";

export const DUPLICATE_PAGE_WINDOW_EVENT = "menu-duplicate-page-window";

const PAGE_WINDOW_MIN_WIDTH = 680;
const PAGE_WINDOW_MIN_HEIGHT = 480;
const PAGE_WINDOW_DEFAULT_WIDTH = 1024;
const PAGE_WINDOW_DEFAULT_HEIGHT = 720;
const PAGE_WINDOW_MAX_WIDTH = 1600;
const PAGE_WINDOW_MAX_HEIGHT = 1200;

interface OpenPageWindowOptions {
  onCreated?: () => void;
  onError?: (error: unknown) => void;
}

interface OpenedPageWindow {
  label: string;
  route: string;
}

function clampDimension(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function getCurrentRoute() {
  const hashRoute = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : "";

  if (hashRoute) {
    return hashRoute.startsWith("/") ? hashRoute : `/${hashRoute}`;
  }

  const pathRoute = `${window.location.pathname}${window.location.search}`;
  return pathRoute && pathRoute !== "/" ? pathRoute : "/";
}

function getWindowTitle() {
  const title = document.title.trim();
  return title ? title : "Lovcode";
}

function getWindowSize() {
  const width = window.outerWidth || window.innerWidth || PAGE_WINDOW_DEFAULT_WIDTH;
  const height = window.outerHeight || window.innerHeight || PAGE_WINDOW_DEFAULT_HEIGHT;

  return {
    width: clampDimension(width, PAGE_WINDOW_MIN_WIDTH, PAGE_WINDOW_MAX_WIDTH),
    height: clampDimension(height, PAGE_WINDOW_MIN_HEIGHT, PAGE_WINDOW_MAX_HEIGHT),
  };
}

function makePageWindowLabel() {
  return `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeBrowserUrl(route: string) {
  return `${window.location.origin}${window.location.pathname}#${route}`;
}

export function getPageWindowErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

export function openCurrentPageInNewWindow(options: OpenPageWindowOptions = {}): OpenedPageWindow {
  const route = getCurrentRoute();
  const label = makePageWindowLabel();

  if (!isTauri()) {
    window.open(makeBrowserUrl(route), "_blank", "noopener,noreferrer");
    options.onCreated?.();
    return { label, route };
  }

  const { width, height } = getWindowSize();
  const pageWindow = new WebviewWindow(label, {
    url: `index.html#${route}`,
    title: getWindowTitle(),
    width,
    height,
    minWidth: PAGE_WINDOW_MIN_WIDTH,
    minHeight: PAGE_WINDOW_MIN_HEIGHT,
    focus: true,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    trafficLightPosition: new LogicalPosition(16, 28),
  });

  void pageWindow.once("tauri://created", () => {
    options.onCreated?.();
  });
  void pageWindow.once("tauri://error", (event) => {
    options.onError?.(event.payload);
  });

  return { label, route };
}

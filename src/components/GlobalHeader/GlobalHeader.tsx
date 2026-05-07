import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PersonIcon, ChevronLeftIcon, ChevronRightIcon,
  LayersIcon, RocketIcon, DashboardIcon,
} from "@radix-ui/react-icons";
import { FlaskConical, Loader2, LogIn, LogOut, MessageSquarePlus, PanelTopOpen, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { useAtom } from "jotai";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { Button } from "../ui/button";
import { FeedbackButton } from "../FeedbackButton";
import { FeedbackAdminDialog } from "../FeedbackAdminDialog";
import { useDuplicatePageWindow } from "@/hooks/useDuplicatePageWindow";
import { useLovstudioAuth } from "@/hooks/useLovstudioAuth";
import { useI18n, type TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { sidebarCollapsedAtom } from "@/store";
import type { FeatureType } from "@/types";

interface GlobalHeaderProps {
  activeFeature: FeatureType | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onFeatureClick: (feature: FeatureType) => void;
  onShowSettings: () => void;
}

// Top-nav features. Active state is decided by RootLayout at the app-section level,
// so child pages can change without coupling the header to every leaf route.
const MAIN_NAV: { feature: FeatureType; labelKey: TranslationKey; icon: ReactNode }[] = [
  {
    feature: "dashboard",
    labelKey: "common.dashboard",
    icon: <DashboardIcon className="w-4 h-4" />,
  },
  {
    feature: "workbench",
    labelKey: "common.workbench",
    icon: <RocketIcon className="w-4 h-4" />,
  },
  {
    feature: "features",
    labelKey: "common.configuration",
    icon: <LayersIcon className="w-4 h-4" />,
  },
  {
    feature: "lab",
    labelKey: "common.lab",
    icon: <FlaskConical className="w-4 h-4" />,
  },
];

export function GlobalHeader({
  activeFeature,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onFeatureClick,
  onShowSettings,
}: GlobalHeaderProps) {
  const lovstudioAuth = useLovstudioAuth();
  const { t } = useI18n();
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const duplicatePageWindow = useDuplicatePageWindow();
  const sidebarToggleLabel = sidebarCollapsed ? t("nav.showSidebar") : t("nav.hideSidebar");

  return (
    <div data-tauri-drag-region className="h-[52px] shrink-0 flex items-center border-b border-border bg-card">
      {/* Left controls: offset for traffic-light buttons on macOS. */}
      <div className="flex items-center gap-0.5 pl-[88px]">
        <HeaderIconButton
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          title={sidebarToggleLabel}
          aria-label={sidebarToggleLabel}
          aria-pressed={!sidebarCollapsed}
        >
          <SidebarToggleGlyph />
        </HeaderIconButton>
        <HeaderIconButton
          onClick={onGoBack}
          disabled={!canGoBack}
          title={t("nav.goBack")}
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </HeaderIconButton>
        <HeaderIconButton
          onClick={onGoForward}
          disabled={!canGoForward}
          title={t("nav.goForward")}
        >
          <ChevronRightIcon className="w-5 h-5" />
        </HeaderIconButton>
        <HeaderIconButton
          onClick={duplicatePageWindow}
          title={t("nav.openPageInNewWindow")}
          aria-label={t("nav.openPageInNewWindow")}
        >
          <PanelTopOpen className="w-4 h-4" />
        </HeaderIconButton>
      </div>
      {/* Center: nav */}
      <div className="flex-1 flex items-center justify-center gap-0.5" data-tauri-drag-region>
        {MAIN_NAV.map((item) => (
          <NavButton
            key={item.feature}
            isActive={activeFeature === item.feature}
            onClick={() => onFeatureClick(item.feature)}
            icon={item.icon}
            label={t(item.labelKey)}
          />
        ))}
      </div>
      {/* Right: profile */}
      <ProfileMenu
        lovstudioAuth={lovstudioAuth}
        onShowSettings={onShowSettings}
      />
    </div>
  );
}

function HeaderIconButton({
  children,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card-alt hover:text-ink disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function SidebarToggleGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3.5" y="3.5" width="9" height="9" rx="2.25" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6.5 4.75V11.25" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
    </svg>
  );
}

function ProfileMenu({
  lovstudioAuth,
  onShowSettings,
}: {
  lovstudioAuth: ReturnType<typeof useLovstudioAuth>;
  onShowSettings: () => void;
}) {
  const { authState, authLoading, loginFlow, loginPolling, startLogin, logout } = lovstudioAuth;
  const { t } = useI18n();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackAdminOpen, setFeedbackAdminOpen] = useState(false);
  const displayName = authState?.user.email || "";
  const fallback = displayName ? displayName.charAt(0).toUpperCase() : <PersonIcon className="w-4 h-4" />;
  const isAdmin = Boolean(authState?.isAdmin);

  return (
    <div className="pr-4">
      <Popover>
        <PopoverTrigger className="rounded-full hover:ring-2 hover:ring-primary/50 transition-all">
          <Avatar className="h-6 w-6 cursor-pointer">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {fallback}
            </AvatarFallback>
          </Avatar>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2">
          <div className="space-y-2">
            <div className="rounded-lg border border-border bg-muted/30 p-2">
              <p className="text-xs text-muted-foreground">{t("auth.lovstudioAccount")}</p>
              {authState ? (
                <>
                  <p className="mt-1 truncate text-sm font-medium text-ink" title={authState.user.email}>
                    {authState.user.email}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() => void logout()}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {t("auth.logout")}
                  </Button>
                </>
              ) : (
                <>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("auth.feedbackTicketHint")}
                  </p>
                  {loginFlow && (
                    <p className="mt-2 inline-flex max-w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs tracking-widest text-foreground">
                      {loginFlow.userCode}
                    </p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => void startLogin()}
                    disabled={authLoading}
                  >
                    {authLoading || loginPolling ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="mr-2 h-4 w-4" />
                    )}
                    {loginFlow ? t("auth.reopen") : t("auth.loginOrRegister")}
                  </Button>
                </>
              )}
            </div>
            <div className="space-y-0.5">
              <button
                onClick={() => setFeedbackOpen(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-md transition-colors"
              >
                <MessageSquarePlus className="w-4 h-4" />
                {t("feedback.submitFeedback")}
              </button>
              {isAdmin && (
                <button
                  onClick={() => setFeedbackAdminOpen(true)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-md transition-colors"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {t("feedback.manageFeedback")}
                </button>
              )}
              <button
                onClick={onShowSettings}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-md transition-colors"
              >
                <SettingsIcon className="w-4 h-4" />
                {t("common.settings")}
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <FeedbackButton open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      {isAdmin && (
        <FeedbackAdminDialog open={feedbackAdminOpen} onOpenChange={setFeedbackAdminOpen} />
      )}
    </div>
  );
}

function NavButton({
  isActive,
  onClick,
  icon,
  label,
}: {
  isActive: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      className={`px-2 py-1.5 rounded flex items-center gap-1.5 overflow-hidden ${
        isActive
          ? "bg-primary/10 text-primary [&_img]:opacity-100"
          : "text-primary/50 hover:text-primary/70 hover:bg-card-alt [&_img]:opacity-50 hover:[&_img]:opacity-70"
      }`}
      title={label}
      layout
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {icon}
      <AnimatePresence mode="wait">
        {isActive && (
          <motion.span
            key={label}
            className="text-sm whitespace-nowrap"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "auto", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

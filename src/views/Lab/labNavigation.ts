import { BookOpen, CalendarDays, ListTodo, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/i18n";

export type LabSectionKey = "wish-room" | "knowledge" | "events";
export type LabActiveKey = "lab" | LabSectionKey;

export interface LabSection {
  key: LabSectionKey;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  path: string;
  icon: LucideIcon;
}

export const LAB_SECTIONS: LabSection[] = [
  {
    key: "wish-room",
    titleKey: "common.wishRoom",
    descriptionKey: "lab.wishRoomDescription",
    path: "/wishes",
    icon: ListTodo,
  },
  {
    key: "knowledge",
    titleKey: "common.knowledge",
    descriptionKey: "lab.knowledgeDescription",
    path: "/knowledge/distill",
    icon: BookOpen,
  },
  {
    key: "events",
    titleKey: "common.events",
    descriptionKey: "lab.eventsDescription",
    path: "/events",
    icon: CalendarDays,
  },
];

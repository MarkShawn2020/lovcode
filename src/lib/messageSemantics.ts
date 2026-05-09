import type { Message } from "@/types";

type MessageSemanticsInput = Pick<Message, "role" | "is_tool"> & {
  content?: string | null;
};

function isWrappedXmlTagContent(content: string | null | undefined, tagName: string) {
  const trimmed = (content ?? "").trimStart();
  return trimmed.startsWith(`<${tagName}>`) && trimmed.includes(`</${tagName}>`);
}

export function isTaskNotificationContent(content: string | null | undefined) {
  return isWrappedXmlTagContent(content, "task-notification");
}

export function isAiAuthoredUserMessage(message: MessageSemanticsInput) {
  return (
    message.role === "user" &&
    !message.is_tool &&
    isTaskNotificationContent(message.content)
  );
}

export function isUserPromptMessage(message: MessageSemanticsInput) {
  return message.role === "user" && !message.is_tool && !isAiAuthoredUserMessage(message);
}

export function getMessageDisplayRole(message: MessageSemanticsInput) {
  return isAiAuthoredUserMessage(message) ? "assistant" : message.role;
}

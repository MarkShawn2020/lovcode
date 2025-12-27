import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { convertFileSrc } from "@tauri-apps/api/core";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function convertImageSrc(src: string | undefined): string {
  if (!src) return "";
  // Local file path (absolute path starting with /)
  if (src.startsWith("/")) {
    return convertFileSrc(src);
  }
  return src;
}

export function MarkdownRenderer({ content, className = "max-w-4xl" }: MarkdownRendererProps) {
  return (
    <article className={`prose prose-warm mx-auto ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          img: ({ src, alt, ...props }) => (
            <img src={convertImageSrc(src)} alt={alt} {...props} />
          ),
        }}
      >
        {content}
      </Markdown>
    </article>
  );
}

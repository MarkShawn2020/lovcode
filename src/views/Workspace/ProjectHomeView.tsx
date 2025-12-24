import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileTextIcon } from "@radix-ui/react-icons";

interface ProjectHomeViewProps {
  projectPath: string;
  projectName: string;
}

export function ProjectHomeView({ projectPath, projectName }: ProjectHomeViewProps) {
  const [readme, setReadme] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const readmeNames = ["README.md", "readme.md", "Readme.md", "README.MD"];

    async function loadReadme() {
      setLoading(true);
      for (const name of readmeNames) {
        try {
          const content = await invoke<string>("get_reference_doc", {
            path: `${projectPath}/${name}`,
          });
          setReadme(content);
          setLoading(false);
          return;
        } catch {
          // Try next name
        }
      }
      setReadme(null);
      setLoading(false);
    }

    loadReadme();
  }, [projectPath]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!readme) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <FileTextIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-serif text-lg font-medium text-ink mb-2">{projectName}</h3>
          <p className="text-muted-foreground">No README.md found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <article className="prose prose-warm max-w-4xl mx-auto">
        <Markdown remarkPlugins={[remarkGfm]}>{readme}</Markdown>
      </article>
    </div>
  );
}

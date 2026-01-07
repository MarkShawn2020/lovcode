/**
 * Command Detail Page
 * - /commands/foo → installed command
 * - /commands/foo?source=marketplace → marketplace template
 */
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { LocalCommand, TemplatesCatalog } from "../../types";
import { CommandDetailView } from "../../views/Commands";
import { TemplateDetailView } from "../../views/Marketplace";
import { FeaturesLayout } from "../../views/Features";
import { LoadingState } from "../../components/config";

export default function CommandDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMarketplace = searchParams.get("source") === "marketplace";

  const { data: command, isLoading: localLoading, refetch } = useQuery({
    queryKey: ["command", name],
    queryFn: async () => {
      const commands = await invoke<LocalCommand[]>("list_local_commands");
      return commands.find(c => c.name === name) ?? null;
    },
    enabled: !!name && !isMarketplace,
  });

  const { data: marketplaceTemplate, isLoading: marketplaceLoading } = useQuery({
    queryKey: ["marketplaceCommand", name],
    queryFn: async () => {
      const catalog = await invoke<TemplatesCatalog>("get_templates_catalog");
      return catalog.commands?.find(t => t.name === name) ?? null;
    },
    enabled: !!name && isMarketplace,
  });

  const isLoading = isMarketplace ? marketplaceLoading : localLoading;

  if (isLoading) {
    return (
      <FeaturesLayout feature="commands">
        <LoadingState message={`Loading ${name}...`} />
      </FeaturesLayout>
    );
  }

  if (isMarketplace) {
    if (!marketplaceTemplate) {
      return (
        <FeaturesLayout feature="commands">
          <div className="p-6">
            <p className="text-destructive">Template "{name}" not found in marketplace</p>
            <button onClick={() => navigate("/commands")} className="mt-2 text-primary hover:underline">
              ← Back to Commands
            </button>
          </div>
        </FeaturesLayout>
      );
    }
    return (
      <FeaturesLayout feature="commands">
        <TemplateDetailView
          template={marketplaceTemplate}
          category="commands"
          onBack={() => navigate("/commands")}
        />
      </FeaturesLayout>
    );
  }

  if (!command) {
    return (
      <FeaturesLayout feature="commands">
        <div className="p-6">
          <p className="text-destructive">Command "{name}" not found</p>
          <button onClick={() => navigate("/commands")} className="mt-2 text-primary hover:underline">
            ← Back to Commands
          </button>
        </div>
      </FeaturesLayout>
    );
  }

  return (
    <FeaturesLayout feature="commands">
      <CommandDetailView
        command={command}
        onBack={() => navigate("/commands")}
        onCommandUpdated={() => refetch()}
        onRenamed={async (newPath: string) => {
          const commands = await invoke<LocalCommand[]>("list_local_commands");
          const cmd = commands.find(c => c.path === newPath);
          if (cmd) navigate(`/commands/${encodeURIComponent(cmd.name)}`);
        }}
      />
    </FeaturesLayout>
  );
}

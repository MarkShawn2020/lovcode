/**
 * Command Detail Page
 * - /commands/foo → installed command
 * - /commands/foo?source=marketplace → marketplace template
 */
import { useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import type { LocalCommand, TemplatesCatalog } from "../../types";
import { CommandDetailView } from "../../views/Commands";
import { TemplateDetailView } from "../../views/Marketplace";
import { FeaturesLayout } from "../../views/Features";
import { LoadingState } from "../../components/config";
import { queryKeys, useInvokeQuery } from "../../hooks";

export default function CommandDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMarketplace = searchParams.get("source") === "marketplace";

  const { data: commands = [], isLoading: localLoading, refetch } = useInvokeQuery<LocalCommand[]>(
    queryKeys.commands,
    "list_local_commands",
    undefined,
    { enabled: !!name && !isMarketplace },
  );
  const command = useMemo(
    () => commands.find((item) => item.name === name) ?? null,
    [commands, name],
  );

  const { data: catalog, isLoading: marketplaceLoading } = useInvokeQuery<TemplatesCatalog>(
    queryKeys.templatesCatalog,
    "get_templates_catalog",
    undefined,
    { enabled: !!name && isMarketplace },
  );
  const marketplaceTemplate = useMemo(
    () => catalog?.commands?.find((template) => template.name === name) ?? null,
    [catalog, name],
  );

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
          const result = await refetch();
          const latestCommands = result.data ?? commands;
          const cmd = latestCommands.find((item) => item.path === newPath);
          if (cmd) navigate(`/commands/${encodeURIComponent(cmd.name)}`);
        }}
      />
    </FeaturesLayout>
  );
}

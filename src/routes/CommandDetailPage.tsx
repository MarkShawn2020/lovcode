/**
 * Command Detail Page - Route-based component
 *
 * Fetches command data based on URL param and renders detail view.
 */
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { LocalCommand } from "../types";
import { CommandDetailView } from "../views/Commands/CommandDetailView";
import { LoadingState } from "../components/config";

export function CommandDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: command, isLoading, error, refetch } = useQuery({
    queryKey: ["command", name],
    queryFn: async () => {
      const commands = await invoke<LocalCommand[]>("list_local_commands");
      const found = commands.find(c => c.name === name);
      if (!found) throw new Error(`Command "${name}" not found`);
      return found;
    },
    enabled: !!name,
  });

  if (isLoading) {
    return <LoadingState message={`Loading ${name}...`} />;
  }

  if (error || !command) {
    return (
      <div className="p-6">
        <p className="text-destructive">Command "{name}" not found</p>
        <button onClick={() => navigate("/commands")} className="mt-2 text-primary hover:underline">
          ← Back to Commands
        </button>
      </div>
    );
  }

  return (
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
  );
}

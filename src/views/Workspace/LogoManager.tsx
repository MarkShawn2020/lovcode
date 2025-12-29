import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ImageIcon,
  UploadIcon,
  MagicWandIcon,
  CheckIcon,
  Cross2Icon,
} from "@radix-ui/react-icons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface LogoManagerProps {
  projectPath: string;
  embedded?: boolean;
}

interface LogoVersion {
  path: string;
  filename: string;
  created_at: number;
  is_current: boolean;
}

/** Generate brand-consistent logo prompt based on project info */
function generateLogoPrompt(projectName: string, projectType?: string): string {
  const name = projectName
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return `Minimalist logo icon for "${name}" software project.
Style: Warm academic, intellectual, high-end minimalist.
Colors: Primary terracotta clay (#CC785C), warm off-white background, deep charcoal accents.
Shape: Simple geometric form, abstract symbol, clean lines.
${projectType ? `Theme: ${projectType} tool/application.` : ""}
No text, no gradients. Single iconic shape. Suitable for app icon and favicon.
Professional, memorable, works at small sizes (32x32).`;
}

export function LogoManager({ projectPath, embedded = false }: LogoManagerProps) {
  const [currentLogo, setCurrentLogo] = useState<string | null>(null);
  const [logoVersions, setLogoVersions] = useState<LogoVersion[]>([]);
  const [showGenDialog, setShowGenDialog] = useState(false);
  const [genPrompt, setGenPrompt] = useState("");
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genPreviews, setGenPreviews] = useState<string[]>([]);
  const [selectedPreview, setSelectedPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Extract project name from path
  const projectName = useMemo(() => {
    const parts = projectPath.split("/");
    return parts[parts.length - 1] || "project";
  }, [projectPath]);

  // Auto-generated prompt based on project
  const autoPrompt = useMemo(() => generateLogoPrompt(projectName), [projectName]);

  // Load current logo and versions
  const loadLogoData = useCallback(async () => {
    try {
      const logo = await invoke<string | null>("get_project_logo", { projectPath });
      setCurrentLogo(logo);

      const versions = await invoke<LogoVersion[]>("list_project_logos", { projectPath });
      setLogoVersions(versions);
    } catch (err) {
      console.error("Failed to load logo:", err);
    }
  }, [projectPath]);

  useEffect(() => {
    loadLogoData();
  }, [loadLogoData]);

  // Generate logo via AI (2 variants in parallel, append to existing)
  const handleGenerate = async () => {
    const prompt = useCustomPrompt ? genPrompt.trim() : autoPrompt;
    if (!prompt) return;

    setGenerating(true);
    setError(null);

    try {
      // Escape prompt for shell (single quotes are safer)
      const escapedPrompt = prompt.replace(/'/g, "'\\''").replace(/\n/g, ' ');
      const scriptPath = "$HOME/.claude/plugins/marketplaces/lovstudio-plugins-official/skills/image-gen/gen_image.py";

      // Generate 2 variants in parallel
      const generateOne = async (index: number): Promise<string> => {
        const outputPath = `/tmp/lovcode-logo-${Date.now()}-${index}.png`;
        await invoke<string>("exec_shell_command", {
          command: `python3 ${scriptPath} '${escapedPrompt}' -o '${outputPath}' -q high --no-open`,
          cwd: projectPath,
        });
        const base64 = await invoke<string>("read_file_base64", { path: outputPath });
        return `data:image/png;base64,${base64}`;
      };

      const results = await Promise.all([generateOne(0), generateOne(1)]);
      // Append new results to existing previews
      setGenPreviews(prev => [...results, ...prev]);
      setSelectedPreview(0); // Select first of new batch
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  // Save selected logo to project
  const handleSaveGenerated = async () => {
    if (selectedPreview === null || !genPreviews[selectedPreview]) return;

    try {
      // Extract base64 data and save to project
      const base64Data = genPreviews[selectedPreview].split(",")[1];
      await invoke("save_project_logo", {
        projectPath,
        base64Data,
        filename: `logo-${Date.now()}.png`,
      });

      setShowGenDialog(false);
      setGenPreviews([]);
      setSelectedPreview(null);
      setGenPrompt("");
      await loadLogoData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Upload logo from local file
  const handleUpload = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        filters: [{ name: "Images", extensions: ["png", "svg", "jpg", "jpeg"] }],
        multiple: false,
      });

      if (selected && typeof selected === "string") {
        await invoke("copy_file_to_project_assets", {
          sourcePath: selected,
          projectPath,
          targetFilename: `logo${selected.substring(selected.lastIndexOf("."))}`,
        });
        await loadLogoData();
      }
    } catch (err) {
      console.error("Failed to upload logo:", err);
    }
  };

  // Set a version as current logo
  const handleSetCurrent = async (version: LogoVersion) => {
    try {
      await invoke("set_current_project_logo", {
        projectPath,
        logoPath: version.path,
      });
      await loadLogoData();
    } catch (err) {
      console.error("Failed to set logo:", err);
    }
  };

  // Delete a logo version
  const handleDelete = async (version: LogoVersion) => {
    try {
      await invoke("delete_project_logo", {
        projectPath,
        logoPath: version.path,
      });
      await loadLogoData();
    } catch (err) {
      console.error("Failed to delete logo:", err);
    }
  };

  if (embedded) {
    return (
      <div className="p-3 space-y-3">
        {/* Current Logo */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center overflow-hidden">
            {currentLogo ? (
              <img src={currentLogo} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <ImageIcon className="w-6 h-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ink">
              {currentLogo ? "Current Logo" : "No Logo"}
            </p>
            <p className="text-xs text-muted-foreground">
              {logoVersions.length} version{logoVersions.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowGenDialog(true)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <MagicWandIcon className="w-3.5 h-3.5" />
            Generate
          </button>
          <button
            onClick={handleUpload}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-muted text-ink rounded-lg hover:bg-muted/80 transition-colors"
          >
            <UploadIcon className="w-3.5 h-3.5" />
            Upload
          </button>
        </div>

        {/* Version History */}
        {logoVersions.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">History</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {logoVersions.slice(0, 5).map((version) => (
                <button
                  key={version.path}
                  onClick={() => handleSetCurrent(version)}
                  className={`relative flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden border-2 transition-colors ${
                    version.is_current
                      ? "border-primary"
                      : "border-transparent hover:border-muted-foreground/30"
                  }`}
                >
                  <img
                    src={`asset://localhost/${version.path}`}
                    alt={version.filename}
                    className="w-full h-full object-contain bg-muted"
                  />
                  {version.is_current && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-primary rounded-tl flex items-center justify-center">
                      <CheckIcon className="w-2 h-2 text-primary-foreground" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Generate Dialog */}
        <Dialog open={showGenDialog} onOpenChange={(open) => {
          setShowGenDialog(open);
          if (!open) {
            setUseCustomPrompt(false);
            setGenPrompt("");
            setGenPreviews([]);
            setSelectedPreview(null);
            setError(null);
          }
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Generate Logo</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* Auto mode info */}
              <div className="p-3 bg-muted/50 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">
                  Auto-generates a <span className="text-primary font-medium">Lovstudio brand-style</span> logo for <span className="font-medium text-ink">{projectName}</span>
                </p>
              </div>

              {/* Custom prompt toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => {
                    if (!useCustomPrompt && !genPrompt) {
                      setGenPrompt(autoPrompt);
                    }
                    setUseCustomPrompt(!useCustomPrompt);
                  }}
                  className="text-xs text-muted-foreground hover:text-ink transition-colors"
                >
                  {useCustomPrompt ? "▼ Hide custom prompt" : "▶ Customize prompt (optional)"}
                </button>

                {useCustomPrompt && (
                  <textarea
                    value={genPrompt}
                    onChange={(e) => setGenPrompt(e.target.value)}
                    className="mt-2 w-full h-28 px-3 py-2 text-xs bg-muted border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                )}
              </div>

              {/* Preview - show all variants in scrollable grid */}
              {genPreviews.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {genPreviews.length} variants - click to select
                    </p>
                    <button
                      onClick={() => {
                        setGenPreviews([]);
                        setSelectedPreview(null);
                      }}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1">
                    <div className="grid grid-cols-4 gap-3">
                      {genPreviews.map((preview, index) => (
                        <button
                          key={index}
                          onClick={() => setSelectedPreview(index)}
                          className={`relative rounded-lg overflow-hidden transition-all ${
                            selectedPreview === index
                              ? "ring-2 ring-primary ring-offset-1"
                              : "opacity-60 hover:opacity-100"
                          }`}
                        >
                          <img
                            src={preview}
                            alt={`Variant ${index + 1}`}
                            className="w-full aspect-square object-contain bg-muted"
                          />
                          {selectedPreview === index && (
                            <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                              <CheckIcon className="w-2.5 h-2.5 text-primary-foreground" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                {genPreviews.length > 0 ? (
                  <>
                    <button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-muted text-ink rounded-lg hover:bg-muted/80 disabled:opacity-50"
                    >
                      {generating ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          Generating...
                        </>
                      ) : (
                        "Regenerate"
                      )}
                    </button>
                    <button
                      onClick={handleSaveGenerated}
                      disabled={selectedPreview === null || generating}
                      className="flex-1 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                    >
                      Save Selected
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleGenerate}
                    disabled={generating || (useCustomPrompt && !genPrompt.trim())}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    {generating ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Generating 2 variants...
                      </>
                    ) : (
                      "Generate"
                    )}
                  </button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Full panel version (for future use)
  return (
    <div className="p-4">
      {/* Full version content */}
    </div>
  );
}

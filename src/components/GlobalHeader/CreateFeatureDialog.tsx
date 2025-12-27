import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

interface CreateFeatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seq: number;
  onSubmit: (name: string, description: string) => void;
}

export function CreateFeatureDialog({
  open,
  onOpenChange,
  seq,
  onSubmit,
}: CreateFeatureDialogProps) {
  const placeholder = `#${seq}`;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setShowPreview(false);
      // Focus name input when dialog opens
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Use placeholder if name is empty
    const finalName = name.trim() || placeholder;
    onSubmit(finalName, description.trim());
    onOpenChange(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    // Tab to accept placeholder
    if (e.key === "Tab" && !name) {
      e.preventDefault();
      setName(placeholder);
    }
    if (e.key === "Enter" && e.metaKey) {
      handleSubmit(e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      handleSubmit(e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>New Feature</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-1 min-h-0">
          <div className="flex gap-4">
            <div className="space-y-2 w-20 flex-shrink-0">
              <Label>ID</Label>
              <div className="h-9 px-3 flex items-center text-sm text-muted-foreground bg-muted rounded-md">
                #{seq}
              </div>
            </div>
            <div className="space-y-2 flex-1">
              <Label htmlFor="feature-name">Title</Label>
              <Input
                ref={nameInputRef}
                id="feature-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={placeholder}
                onKeyDown={handleNameKeyDown}
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="feature-description">Description</Label>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setShowPreview(false)}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${
                    !showPreview
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-ink"
                  }`}
                >
                  Write
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreview(true)}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${
                    showPreview
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-ink"
                  }`}
                >
                  Preview
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-[200px] border border-border rounded-lg overflow-hidden">
              {showPreview ? (
                <div className="h-full overflow-auto p-4 bg-card">
                  {description ? (
                    <MarkdownRenderer content={description} className="max-w-none" />
                  ) : (
                    <p className="text-muted-foreground text-sm italic">No description</p>
                  )}
                </div>
              ) : (
                <textarea
                  id="feature-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the feature... (Markdown supported)

## Background
Why is this feature needed?

## Goals
What should be achieved?

## Notes
Any additional context..."
                  className="w-full h-full p-4 bg-card text-sm resize-none outline-none placeholder:text-muted-foreground/50"
                  onKeyDown={handleKeyDown}
                />
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

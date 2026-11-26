"use client";

import { Bookmark } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface SaveQueryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialTitle?: string;
  initialDescription?: string;
  initialIsFavorite?: boolean;
  sqlPreview: string;
  mode?: "create" | "edit";
  onSave: (data: { title: string; description: string; isFavorite: boolean }) => Promise<void>;
}

export function SaveQueryDialog({
  isOpen,
  onClose,
  initialTitle = "",
  initialDescription = "",
  initialIsFavorite = false,
  sqlPreview,
  mode = "create",
  onSave,
}: SaveQueryDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle);
      setDescription(initialDescription);
      setIsFavorite(initialIsFavorite);
      setError(null);
    }
  }, [isOpen, initialTitle, initialDescription, initialIsFavorite]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!sqlPreview.trim()) {
      setError("SQL query cannot be empty");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        isFavorite,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save query snippet");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bookmark className="h-4 w-4 text-indigo-500" aria-hidden="true" />
              <span>{mode === "edit" ? "Edit Query Snippet" : "Save Query Snippet"}</span>
            </DialogTitle>
            <DialogDescription>
              Save this SQL statement to your project library for quick reuse across sessions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <label htmlFor="snippet-title" className="text-xs font-medium text-foreground">
                Title
              </label>
              <Input
                id="snippet-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. Active users last 7 days"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="snippet-description" className="text-xs font-medium text-foreground">
                Description (optional)
              </label>
              <Textarea
                id="snippet-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this query checks or updates..."
                rows={2}
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs select-none">
              <input
                type="checkbox"
                checked={isFavorite}
                onChange={(e) => setIsFavorite(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <span className="font-medium text-foreground">Pin as favorite snippet</span>
            </label>

            {error && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSaving} disabled={isSaving || !title.trim()}>
              {mode === "edit" ? "Save Changes" : "Save Snippet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

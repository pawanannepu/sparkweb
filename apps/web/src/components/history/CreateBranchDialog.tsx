"use client";

import { GitBranch } from "lucide-react";
import { type FormEvent, useState } from "react";
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

export interface CreateBranchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, switchActive: boolean) => Promise<boolean | undefined>;
  fromSnapshotId?: string | null;
  fromSnapshotMessage?: string | null;
}

export function CreateBranchDialog({
  isOpen,
  onClose,
  onSubmit,
  fromSnapshotId,
  fromSnapshotMessage,
}: CreateBranchDialogProps) {
  const [name, setName] = useState("");
  const [switchActive, setSwitchActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const sanitized = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/(^-|-$)/g, "");

    if (!sanitized) {
      setValidationError("Branch name is required");
      return;
    }
    if (sanitized.length > 50) {
      setValidationError("Branch name must be 50 characters or fewer");
      return;
    }

    setValidationError(null);
    setIsSubmitting(true);
    try {
      const ok = await onSubmit(sanitized, switchActive);
      if (ok !== false) {
        setName("");
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              <span>Create New Branch</span>
            </DialogTitle>
            <DialogDescription>
              {fromSnapshotId ? (
                <>
                  Branching from historical snapshot{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">
                    {fromSnapshotId.slice(0, 8)}
                  </code>
                  {fromSnapshotMessage ? ` (${fromSnapshotMessage})` : ""}
                </>
              ) : (
                "Branch your project to safely explore design variations or code changes."
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="branch-name" className="text-xs font-semibold text-foreground">
                Branch Name
              </label>
              <Input
                id="branch-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setValidationError(null);
                }}
                placeholder="e.g. experiment-dark-mode"
                className="font-mono text-sm"
                autoFocus
              />
              {validationError && (
                <p className="text-xs text-destructive font-medium">{validationError}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Use lowercase letters, numbers, and hyphens. Max 50 characters.
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-xs select-none">
              <input
                type="checkbox"
                checked={switchActive}
                onChange={(e) => setSwitchActive(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary h-4 w-4"
              />
              <span className="font-medium text-foreground">Switch to this branch immediately</span>
            </label>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? "Creating..." : "Create Branch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DeleteRowDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  primaryKeyValues: Record<string, unknown> | null;
  onConfirm: () => Promise<{ success: boolean; error?: string }>;
}

export function DeleteRowDialog({
  isOpen,
  onClose,
  tableName,
  primaryKeyValues,
  onConfirm,
}: DeleteRowDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      const res = await onConfirm();
      if (res.success) {
        onClose();
      } else {
        setError(res.error || "Failed to delete row");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete row");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            <span>Delete Row</span>
          </DialogTitle>
          <DialogDescription>
            This permanently deletes the selected record from{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{tableName}</code>.
          </DialogDescription>
        </DialogHeader>

        {primaryKeyValues && (
          <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
            {Object.entries(primaryKeyValues).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{k}:</span>
                <span className="font-semibold text-foreground">{String(v)}</span>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            isLoading={isDeleting}
            disabled={isDeleting}
          >
            Delete Row
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

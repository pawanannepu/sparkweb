"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DestructiveSqlDialogProps {
  isOpen: boolean;
  onClose: () => void;
  reasons: string[];
  sqlPreview: string;
  onConfirm: () => void;
}

export function DestructiveSqlDialog({
  isOpen,
  onClose,
  reasons,
  sqlPreview,
  onConfirm,
}: DestructiveSqlDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            <span>Confirm Destructive SQL Statement</span>
          </DialogTitle>
          <DialogDescription>
            This query contains operations that permanently remove tables or rows from your preview
            database.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <ul className="list-disc space-y-1 pl-5 text-xs text-foreground">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>

          <pre className="max-h-36 overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs text-foreground">
            {sqlPreview}
          </pre>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            Execute Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

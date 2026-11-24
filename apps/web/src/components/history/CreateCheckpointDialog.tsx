"use client";

import { Bookmark } from "lucide-react";
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

export interface CreateCheckpointDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (message: string, tag?: string) => Promise<boolean | undefined>;
}

export function CreateCheckpointDialog({ isOpen, onClose, onSubmit }: CreateCheckpointDialogProps) {
  const [message, setMessage] = useState("");
  const [tag, setTag] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setIsSubmitting(true);
    try {
      const ok = await onSubmit(message.trim(), tag.trim() || undefined);
      if (ok !== false) {
        setMessage("");
        setTag("");
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
              <Bookmark className="h-5 w-5 text-emerald-500" />
              <span>Save Manual Checkpoint</span>
            </DialogTitle>
            <DialogDescription>
              Create an immutable snapshot of your project state with a descriptive message and
              optional tag.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="checkpoint-message" className="text-xs font-semibold text-foreground">
                Checkpoint Summary
              </label>
              <Input
                id="checkpoint-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="e.g. Completed navigation bar redesign"
                className="text-sm"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="checkpoint-tag" className="text-xs font-semibold text-foreground">
                Release Tag (Optional)
              </label>
              <Input
                id="checkpoint-tag"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="e.g. v1.0-beta"
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Tags help mark milestone releases or major architectural versions.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !message.trim()}>
              {isSubmitting ? "Saving..." : "Save Checkpoint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

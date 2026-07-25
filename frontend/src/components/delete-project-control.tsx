"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/lib/store/projects-store";
import { cn } from "@/lib/utils";

/**
 * Delete a project, gated by a confirmation dialog.
 *
 * - mode="icon"   → a hover-revealable trash icon (for cards / list rows)
 * - mode="button" → a labelled "Delete" ghost button (for the project header)
 *
 * When placed inside a <Link> (e.g. a dashboard card), the trigger calls
 * preventDefault + stopPropagation so opening the dialog doesn't navigate.
 */
export function DeleteProjectControl({
  projectId,
  projectName,
  mode = "icon",
  className,
  onDeleted,
}: {
  projectId: string;
  projectName: string;
  mode?: "icon" | "button";
  className?: string;
  onDeleted?: () => void;
}) {
  const { removeProject } = useProjects();
  const [open, setOpen] = useState(false);

  const openDialog = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      {mode === "button" ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={openDialog}
          className={cn("text-foreground-muted hover:text-destructive", className)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          title={`Delete ${projectName}`}
          aria-label={`Delete ${projectName}`}
          className={cn(
            "inline-flex items-center justify-center rounded-md p-1 text-foreground-subtle hover:text-destructive hover:bg-destructive/10 transition-colors",
            className
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          // Stop clicks inside the dialog from bubbling to a parent <Link>.
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              Delete &ldquo;{projectName}&rdquo;?
            </DialogTitle>
            <DialogDescription>
              This removes the project and everything Iota built for it from
              this browser. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                removeProject(projectId);
                setOpen(false);
                onDeleted?.();
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete project
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

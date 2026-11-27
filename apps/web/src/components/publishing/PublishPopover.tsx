"use client";

import type { DeploymentSummary, ProjectDomainSummary } from "@spark/shared";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  PowerOff,
  Rocket,
  RotateCcw,
  Settings2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface PublishPopoverProps {
  domain: ProjectDomainSummary | null;
  activeDeployment: DeploymentSummary | null;
  deployments: DeploymentSummary[];
  inProgressDeployment?: DeploymentSummary;
  isPublishing: boolean;
  isStreaming: boolean;
  previewClean: boolean;
  error: string | null;
  onPublish: () => void;
  onRollback: (deploymentId: string) => void;
  onUnpublish: () => void;
  onOpenDomainDialog: () => void;
}

function formatShortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function PublishPopover({
  domain,
  activeDeployment,
  deployments,
  inProgressDeployment,
  isPublishing,
  isStreaming,
  previewClean,
  error,
  onPublish,
  onRollback,
  onUnpublish,
  onOpenDomainDialog,
}: PublishPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const latestDeployment = deployments[0] ?? null;
  const isBuildRunning = isPublishing || Boolean(inProgressDeployment);
  const liveUrl = activeDeployment?.deploymentUrl ?? null;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleCopyUrl = async () => {
    if (!liveUrl) return;
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // Clipboard unavailable in restricted contexts
    }
  };

  const publishDisabled = isBuildRunning || isStreaming || !previewClean;

  const statusBadge = isBuildRunning ? (
    <Badge variant="secondary" className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-300">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      <span>Building</span>
    </Badge>
  ) : activeDeployment ? (
    <Badge
      variant="secondary"
      className="gap-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      <span>Live</span>
    </Badge>
  ) : latestDeployment?.status === "failed" ? (
    <Badge variant="destructive" className="gap-1">
      <AlertCircle className="h-3 w-3" aria-hidden="true" />
      <span>Failed</span>
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Unpublished
    </Badge>
  );

  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant={activeDeployment ? "outline" : "default"}
        size="sm"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((prev) => !prev)}
        className="h-8 gap-1.5 text-xs font-medium"
      >
        {isBuildRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : activeDeployment ? (
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
        ) : (
          <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span>{isBuildRunning ? "Publishing..." : "Publish"}</span>
      </Button>

      {isOpen && (
        <section
          id={panelId}
          aria-label="Publishing controls"
          className="absolute right-0 top-10 z-50 w-96 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Live Hosting</h2>
            </div>
            {statusBadge}
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            Publish your current snapshot to an isolated live URL. Workspace edits remain in preview
            until you publish again.
          </p>

          {liveUrl && (
            <div className="mt-3 flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate font-mono text-xs text-foreground hover:underline"
              >
                {liveUrl}
              </a>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={handleCopyUrl}
                aria-label="Copy live URL"
              >
                {copiedUrl ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open live site in new tab"
                className={cn(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {domain?.customDomain && (
            <div className="mt-2 flex items-center justify-between rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-xs">
              <span className="truncate font-mono text-foreground">{domain.customDomain}</span>
              <Badge
                variant={domain.sslStatus === "active" ? "secondary" : "outline"}
                className="ml-2 shrink-0 text-[10px]"
              >
                {domain.verificationStatus === "verified" && domain.sslStatus === "active"
                  ? "SSL Active"
                  : `DNS ${domain.verificationStatus}`}
              </Badge>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </div>
          )}

          {!previewClean && (
            <div
              role="alert"
              className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
            >
              Resolve preview errors before publishing to live.
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="flex-1 gap-1.5 text-xs"
              disabled={publishDisabled}
              onClick={onPublish}
            >
              {isBuildRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>
                {isBuildRunning
                  ? "Building bundle..."
                  : activeDeployment
                    ? "Publish Update"
                    : "Publish Site"}
              </span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => {
                setIsOpen(false);
                onOpenDomainDialog();
              }}
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Domains</span>
            </Button>
          </div>

          {/* Latest Build Status & Collapsible Failure Logs */}
          {latestDeployment &&
            (latestDeployment.status === "failed" || latestDeployment.buildLogs) && (
              <div className="mt-3 rounded-md border border-border/80 bg-muted/30">
                <button
                  type="button"
                  onClick={() => setShowLogs((prev) => !prev)}
                  aria-expanded={showLogs}
                  className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs font-medium text-foreground hover:bg-muted/50"
                >
                  <span className="flex items-center gap-1.5">
                    {showLogs ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {latestDeployment.status === "failed"
                        ? "Build failed — view logs"
                        : "Build logs"}
                    </span>
                  </span>
                  {latestDeployment.buildDurationMs !== null && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {(latestDeployment.buildDurationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </button>

                {latestDeployment.status === "failed" && latestDeployment.errorMessage && (
                  <p className="border-t border-border/60 px-2.5 py-1.5 text-xs text-destructive">
                    {latestDeployment.errorMessage}
                  </p>
                )}

                {showLogs && latestDeployment.buildLogs && (
                  <ScrollArea className="max-h-36 border-t border-border/60 p-2.5">
                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                      {latestDeployment.buildLogs}
                    </pre>
                  </ScrollArea>
                )}
              </div>
            )}

          {/* Recent Deployments & Rollback */}
          {deployments.length > 0 && (
            <>
              <Separator className="my-3" />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Recent Releases
                  </span>
                  {activeDeployment && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={isBuildRunning}
                      onClick={onUnpublish}
                    >
                      <PowerOff className="h-3 w-3" aria-hidden="true" />
                      <span>Unpublish</span>
                    </Button>
                  )}
                </div>

                <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {deployments.slice(0, 5).map((dep) => {
                    const canRollback =
                      dep.status !== "active" &&
                      dep.status !== "queued" &&
                      dep.status !== "building" &&
                      dep.status !== "failed" &&
                      Boolean(dep.artifactKey);

                    return (
                      <li
                        key={dep.id}
                        className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full shrink-0",
                                dep.status === "active"
                                  ? "bg-emerald-500"
                                  : dep.status === "failed"
                                    ? "bg-destructive"
                                    : dep.status === "retired"
                                      ? "bg-muted-foreground/60"
                                      : "bg-amber-500"
                              )}
                              aria-hidden="true"
                            />
                            <span className="font-mono text-[11px] font-medium capitalize">
                              {dep.status}
                            </span>
                            {dep.trigger === "rollback" && (
                              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                                rollback
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                            {dep.id.slice(0, 8)} · {formatShortTime(dep.createdAt)}
                          </p>
                        </div>

                        {canRollback && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isBuildRunning}
                            onClick={() => onRollback(dep.id)}
                            className="h-6 gap-1 px-2 text-[11px]"
                            aria-label={`Roll back to release ${dep.id.slice(0, 8)}`}
                          >
                            <RotateCcw className="h-3 w-3" aria-hidden="true" />
                            <span>Rollback</span>
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

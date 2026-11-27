"use client";

import type { DnsInstructions, ProjectDomainSummary } from "@spark/shared";
import { Check, Copy, Globe, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";

export interface CustomDomainDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: ProjectDomainSummary | null;
  dnsInstructions: DnsInstructions | null;
  isUpdating: boolean;
  isVerifying: boolean;
  error: string | null;
  onUpdateSubdomain: (subdomain: string) => Promise<boolean>;
  onSaveCustomDomain: (customDomain: string) => Promise<boolean>;
  onVerifyDomain: () => Promise<boolean>;
  onRemoveCustomDomain: () => Promise<boolean>;
}

export function CustomDomainDialog({
  open,
  onOpenChange,
  domain,
  dnsInstructions,
  isUpdating,
  isVerifying,
  error,
  onUpdateSubdomain,
  onSaveCustomDomain,
  onVerifyDomain,
  onRemoveCustomDomain,
}: CustomDomainDialogProps) {
  const [subdomainInput, setSubdomainInput] = useState(domain?.subdomain ?? "");
  const [customDomainInput, setCustomDomainInput] = useState(domain?.customDomain ?? "");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSubdomainInput(domain?.subdomain ?? "");
      setCustomDomainInput(domain?.customDomain ?? "");
    }
  }, [domain?.subdomain, domain?.customDomain, open]);

  const handleCopyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleSubdomainSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!subdomainInput.trim()) return;
    await onUpdateSubdomain(subdomainInput.trim());
  };

  const handleCustomDomainSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customDomainInput.trim()) return;
    await onSaveCustomDomain(customDomainInput.trim());
  };

  const activeInstructions: DnsInstructions | null =
    dnsInstructions ??
    (domain?.customDomain && domain.recordType && domain.verificationToken
      ? {
          customDomain: domain.customDomain,
          recordType: domain.recordType,
          records: [
            {
              type: "TXT",
              host: `_sparkweb-verify.${domain.customDomain}`,
              value: domain.verificationToken,
              purpose: "Verify domain ownership before issuing SSL certificate",
            },
            domain.recordType === "apex"
              ? {
                  type: "A",
                  host: "@",
                  value: "192.0.2.1",
                  purpose: "Point apex domain traffic to Sparkweb edge",
                }
              : {
                  type: "CNAME",
                  host: domain.customDomain,
                  value: "edge.sparkapps.dev",
                  purpose: "Point subdomain traffic to Sparkweb edge",
                },
          ],
        }
      : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" aria-hidden="true" />
            <span>Domain & SSL Settings</span>
          </DialogTitle>
          <DialogDescription>
            Customize your platform subdomain or connect a custom domain with automatic SSL.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </div>
          )}

          {/* Platform Subdomain Section */}
          <form onSubmit={handleSubdomainSubmit} className="space-y-2">
            <label
              htmlFor="platform-subdomain-input"
              className="text-xs font-semibold text-foreground"
            >
              Platform Subdomain
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="platform-subdomain-input"
                value={subdomainInput}
                onChange={(e) => setSubdomainInput(e.target.value)}
                placeholder="my-app"
                className="font-mono text-sm"
                disabled={isUpdating}
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={isUpdating || !subdomainInput.trim()}
              >
                {isUpdating ? "Saving..." : "Update"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Lowercase letters, numbers, and hyphens (3 to 63 characters).
            </p>
          </form>

          <Separator />

          {/* Custom Domain Section */}
          <form onSubmit={handleCustomDomainSubmit} className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="custom-domain-input"
                className="text-xs font-semibold text-foreground"
              >
                Custom Domain
              </label>
              {domain?.customDomain && (
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant={domain.verificationStatus === "verified" ? "secondary" : "outline"}
                    className="text-[10px]"
                  >
                    DNS: {domain.verificationStatus}
                  </Badge>
                  <Badge
                    variant={domain.sslStatus === "active" ? "secondary" : "outline"}
                    className="text-[10px]"
                  >
                    SSL: {domain.sslStatus}
                  </Badge>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Input
                id="custom-domain-input"
                value={customDomainInput}
                onChange={(e) => setCustomDomainInput(e.target.value)}
                placeholder="app.yourdomain.com"
                className="font-mono text-sm"
                disabled={isUpdating}
              />
              <Button type="submit" size="sm" disabled={isUpdating || !customDomainInput.trim()}>
                {isUpdating ? "Saving..." : "Connect"}
              </Button>
            </div>
          </form>

          {domain?.failureReason && (
            <div
              role="alert"
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
            >
              {domain.failureReason}
            </div>
          )}

          {activeInstructions && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span>Required DNS Records</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    disabled={isVerifying}
                    onClick={onVerifyDomain}
                  >
                    {isVerifying ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    )}
                    <span>{isVerifying ? "Checking..." : "Verify DNS"}</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={isUpdating}
                    onClick={onRemoveCustomDomain}
                    aria-label="Remove custom domain"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    <span>Remove</span>
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">Type</th>
                      <th className="py-1.5 pr-2 font-medium">Name / Host</th>
                      <th className="py-1.5 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 font-mono text-[11px]">
                    {activeInstructions.records.map((rec) => (
                      <tr key={`${rec.type}-${rec.host}`}>
                        <td className="py-2 pr-2 font-semibold">{rec.type}</td>
                        <td className="py-2 pr-2 break-all">{rec.host}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-1">
                            <span className="break-all">{rec.value}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 shrink-0"
                              aria-label={`Copy ${rec.type} value`}
                              onClick={() => handleCopyValue(`${rec.type}-val`, rec.value)}
                            >
                              {copiedKey === `${rec.type}-val` ? (
                                <Check className="h-3 w-3 text-emerald-500" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

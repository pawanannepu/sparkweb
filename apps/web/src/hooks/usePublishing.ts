"use client";

import type {
  DeploymentSummary,
  DeploymentsListResponse,
  DnsInstructions,
  DomainUpdateResponse,
  ProjectDomainSummary,
  PublishTriggerResponse,
} from "@spark/shared";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UsePublishingOptions {
  projectId: string;
}

export function usePublishing({ projectId }: UsePublishingOptions) {
  const [domain, setDomain] = useState<ProjectDomainSummary | null>(null);
  const [activeDeployment, setActiveDeployment] = useState<DeploymentSummary | null>(null);
  const [deployments, setDeployments] = useState<DeploymentSummary[]>([]);
  const [dnsInstructions, setDnsInstructions] = useState<DnsInstructions | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUpdatingDomain, setIsUpdatingDomain] = useState(false);
  const [isVerifyingDomain, setIsVerifyingDomain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchDeployments = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/deployments?limit=10`);
      if (!res.ok) return;
      const data = (await res.json()) as DeploymentsListResponse;
      setDomain(data.domain);
      setActiveDeployment(data.activeDeployment);
      setDeployments(data.items);
    } catch {
      // Ignore transient network errors on initial hydration
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchDeployments();
    return () => stopPolling();
  }, [fetchDeployments, stopPolling]);

  const inProgressDeployment = deployments.find(
    (d) => d.status === "queued" || d.status === "building"
  );

  useEffect(() => {
    if (!inProgressDeployment) {
      stopPolling();
      return;
    }

    stopPolling();
    const targetId = inProgressDeployment.id;
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/deployments/${targetId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { deployment: DeploymentSummary };
        const updated = data.deployment;

        setDeployments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));

        if (updated.status === "active" || updated.status === "failed") {
          stopPolling();
          void fetchDeployments();
        }
      } catch {
        // Keep polling on transient failures
      }
    }, 1500);

    return () => stopPolling();
  }, [inProgressDeployment, projectId, fetchDeployments, stopPolling]);

  const publishNow = useCallback(
    async (params: { previewClean: boolean; isStreaming: boolean; snapshotId?: string }) => {
      setError(null);
      setIsPublishing(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/deployments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        const data = (await res.json()) as PublishTriggerResponse & { error?: string };
        if (!res.ok) {
          setError(data.error || "Failed to publish project");
          return null;
        }

        setDomain(data.domain);
        setDeployments((prev) => [
          data.deployment,
          ...prev.filter((d) => d.id !== data.deployment.id),
        ]);
        return data.deployment;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to publish project");
        return null;
      } finally {
        setIsPublishing(false);
      }
    },
    [projectId]
  );

  const rollbackDeployment = useCallback(
    async (deploymentId: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/deployments/${deploymentId}/rollback`, {
          method: "POST",
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error || "Failed to roll back deployment");
          return false;
        }
        await fetchDeployments();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to roll back deployment");
        return false;
      }
    },
    [projectId, fetchDeployments]
  );

  const unpublish = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/deployments/unpublish`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Failed to unpublish site");
        return false;
      }
      await fetchDeployments();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unpublish site");
      return false;
    }
  }, [projectId, fetchDeployments]);

  const updateSubdomain = useCallback(
    async (subdomain: string) => {
      setDomainError(null);
      setIsUpdatingDomain(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/domain`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomain }),
        });
        const data = (await res.json()) as DomainUpdateResponse & { error?: string };
        if (!res.ok) {
          setDomainError(data.error || "Failed to update subdomain");
          return false;
        }
        setDomain(data.domain);
        if (data.dnsInstructions) {
          setDnsInstructions(data.dnsInstructions);
        }
        await fetchDeployments();
        return true;
      } catch (err) {
        setDomainError(err instanceof Error ? err.message : "Failed to update subdomain");
        return false;
      } finally {
        setIsUpdatingDomain(false);
      }
    },
    [projectId, fetchDeployments]
  );

  const saveCustomDomain = useCallback(
    async (customDomain: string) => {
      setDomainError(null);
      setIsUpdatingDomain(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/domain`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customDomain }),
        });
        const data = (await res.json()) as DomainUpdateResponse & { error?: string };
        if (!res.ok) {
          setDomainError(data.error || "Failed to save custom domain");
          return false;
        }
        setDomain(data.domain);
        setDnsInstructions(data.dnsInstructions);
        return true;
      } catch (err) {
        setDomainError(err instanceof Error ? err.message : "Failed to save custom domain");
        return false;
      } finally {
        setIsUpdatingDomain(false);
      }
    },
    [projectId]
  );

  const verifyCustomDomain = useCallback(async () => {
    setDomainError(null);
    setIsVerifyingDomain(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/domain/verify`, {
        method: "POST",
      });
      const data = (await res.json()) as { domain?: ProjectDomainSummary; error?: string };
      if (!res.ok) {
        setDomainError(data.error || "DNS verification failed");
        return false;
      }
      if (data.domain) {
        setDomain(data.domain);
      }
      await fetchDeployments();
      return true;
    } catch (err) {
      setDomainError(err instanceof Error ? err.message : "DNS verification failed");
      return false;
    } finally {
      setIsVerifyingDomain(false);
    }
  }, [projectId, fetchDeployments]);

  const removeCustomDomain = useCallback(async () => {
    setDomainError(null);
    setIsUpdatingDomain(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/domain/custom`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { domain?: ProjectDomainSummary; error?: string };
      if (!res.ok) {
        setDomainError(data.error || "Failed to remove custom domain");
        return false;
      }
      if (data.domain) {
        setDomain(data.domain);
      }
      setDnsInstructions(null);
      await fetchDeployments();
      return true;
    } catch (err) {
      setDomainError(err instanceof Error ? err.message : "Failed to remove custom domain");
      return false;
    } finally {
      setIsUpdatingDomain(false);
    }
  }, [projectId, fetchDeployments]);

  return {
    domain,
    activeDeployment,
    deployments,
    inProgressDeployment,
    dnsInstructions,
    isLoading,
    isPublishing,
    isUpdatingDomain,
    isVerifyingDomain,
    error,
    domainError,
    clearError: () => setError(null),
    clearDomainError: () => setDomainError(null),
    refresh: fetchDeployments,
    publishNow,
    rollbackDeployment,
    unpublish,
    updateSubdomain,
    saveCustomDomain,
    verifyCustomDomain,
    removeCustomDomain,
  };
}

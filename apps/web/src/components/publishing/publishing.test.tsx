import type { DeploymentSummary, ProjectDomainSummary } from "@spark/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CustomDomainDialog, PublishPopover } from "./index";

const baseDomain: ProjectDomainSummary = {
  id: "dom-1",
  projectId: "proj-1",
  subdomain: "demo-app",
  customDomain: null,
  recordType: null,
  verificationToken: null,
  verificationStatus: "unconfigured",
  sslStatus: "unconfigured",
  failureReason: null,
  lastCheckedAt: null,
  verifiedAt: null,
  createdAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:00:00.000Z",
};

const activeDeployment: DeploymentSummary = {
  id: "dep-active-1",
  projectId: "proj-1",
  snapshotId: "snap-1",
  subdomain: "demo-app",
  customDomain: null,
  status: "active",
  deploymentUrl: "http://demo-app.localhost:3000",
  artifactKey: "deployments/proj-1/dep-active-1",
  buildLogs: "Built in 1.1s",
  buildDurationMs: 1100,
  errorMessage: null,
  trigger: "manual",
  promotedFromDeploymentId: null,
  retiredAt: null,
  createdAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:00:00.000Z",
};

const retiredDeployment: DeploymentSummary = {
  ...activeDeployment,
  id: "dep-old-2",
  status: "retired",
  retiredAt: "2026-11-26T00:05:00.000Z",
};

describe("Publishing UI components", () => {
  it("renders PublishPopover controls, triggers publish, rollback, unpublish, and opens domains dialog (AC-10)", async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn();
    const onRollback = vi.fn();
    const onUnpublish = vi.fn();
    const onOpenDomainDialog = vi.fn();

    render(
      <PublishPopover
        domain={baseDomain}
        activeDeployment={activeDeployment}
        deployments={[activeDeployment, retiredDeployment]}
        isPublishing={false}
        isStreaming={false}
        previewClean={true}
        error={null}
        onPublish={onPublish}
        onRollback={onRollback}
        onUnpublish={onUnpublish}
        onOpenDomainDialog={onOpenDomainDialog}
      />
    );

    const trigger = screen.getByRole("button", { name: /Publish/i });
    await user.click(trigger);

    expect(screen.getByText("http://demo-app.localhost:3000")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Publish Update/i }));
    expect(onPublish).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Roll back to release dep-old-/i }));
    expect(onRollback).toHaveBeenCalledWith("dep-old-2");

    await user.click(screen.getByRole("button", { name: /Unpublish/i }));
    expect(onUnpublish).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Domains/i }));
    expect(onOpenDomainDialog).toHaveBeenCalledTimes(1);
  });

  it("renders CustomDomainDialog DNS instructions and triggers subdomain/custom domain actions (AC-10)", async () => {
    const user = userEvent.setup();
    const onUpdateSubdomain = vi.fn().mockResolvedValue(true);
    const onSaveCustomDomain = vi.fn().mockResolvedValue(true);
    const onVerifyDomain = vi.fn().mockResolvedValue(true);
    const onRemoveCustomDomain = vi.fn().mockResolvedValue(true);

    const customDomain: ProjectDomainSummary = {
      ...baseDomain,
      customDomain: "app.example.com",
      recordType: "cname",
      verificationToken: "spark-verify=abc123",
      verificationStatus: "pending",
      sslStatus: "unconfigured",
    };

    render(
      <CustomDomainDialog
        open={true}
        onOpenChange={vi.fn()}
        domain={customDomain}
        dnsInstructions={null}
        isUpdating={false}
        isVerifying={false}
        error={null}
        onUpdateSubdomain={onUpdateSubdomain}
        onSaveCustomDomain={onSaveCustomDomain}
        onVerifyDomain={onVerifyDomain}
        onRemoveCustomDomain={onRemoveCustomDomain}
      />
    );

    expect(screen.getByText("_sparkweb-verify.app.example.com")).toBeInTheDocument();
    expect(screen.getByText("spark-verify=abc123")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Verify DNS/i }));
    expect(onVerifyDomain).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Remove custom domain/i }));
    expect(onRemoveCustomDomain).toHaveBeenCalledTimes(1);
  });

  // covers: AC-10
  it("renders Unpublished, Building, and Failed states with collapsible failure logs and guard alerts", async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <PublishPopover
        domain={baseDomain}
        activeDeployment={null}
        deployments={[]}
        isPublishing={false}
        isStreaming={false}
        previewClean={false}
        error="Publish blocked"
        onPublish={vi.fn()}
        onRollback={vi.fn()}
        onUnpublish={vi.fn()}
        onOpenDomainDialog={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: /Publish/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    expect(screen.getByText("Unpublished")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish Site/i })).toBeDisabled();
    expect(screen.getByText("Publish blocked")).toBeInTheDocument();
    expect(
      screen.getByText("Resolve preview errors before publishing to live.")
    ).toBeInTheDocument();

    rerender(
      <PublishPopover
        domain={baseDomain}
        activeDeployment={null}
        deployments={[]}
        inProgressDeployment={{ ...activeDeployment, status: "building" }}
        isPublishing={false}
        isStreaming={false}
        previewClean={true}
        error={null}
        onPublish={vi.fn()}
        onRollback={vi.fn()}
        onUnpublish={vi.fn()}
        onOpenDomainDialog={vi.fn()}
      />
    );
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Building bundle/i })).toBeDisabled();

    const failedDeployment: DeploymentSummary = {
      ...activeDeployment,
      id: "dep-fail-1",
      status: "failed",
      buildDurationMs: 4200,
      errorMessage: "Vite build failed",
      buildLogs: "SyntaxError in App.tsx:12",
    };

    rerender(
      <PublishPopover
        domain={{
          ...baseDomain,
          customDomain: "app.example.com",
          verificationStatus: "verified",
          sslStatus: "active",
        }}
        activeDeployment={null}
        deployments={[failedDeployment]}
        isPublishing={false}
        isStreaming={true}
        previewClean={true}
        error={null}
        onPublish={vi.fn()}
        onRollback={vi.fn()}
        onUnpublish={vi.fn()}
        onOpenDomainDialog={vi.fn()}
      />
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("app.example.com")).toBeInTheDocument();
    expect(screen.getByText("SSL Active")).toBeInTheDocument();
    expect(screen.getByText("Vite build failed")).toBeInTheDocument();
    expect(screen.getByText("4.2s")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish Site/i })).toBeDisabled();

    const logsToggle = screen.getByRole("button", { name: /Build failed — view logs/i });
    expect(logsToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(logsToggle);
    expect(logsToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("SyntaxError in App.tsx:12")).toBeInTheDocument();
  });

  // covers: AC-10
  it("copies live URL, closes on Escape restoring trigger focus, and closes on outside click", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <div>
        <button type="button">Outside</button>
        <PublishPopover
          domain={baseDomain}
          activeDeployment={activeDeployment}
          deployments={[activeDeployment]}
          isPublishing={false}
          isStreaming={false}
          previewClean={true}
          error={null}
          onPublish={vi.fn()}
          onRollback={vi.fn()}
          onUnpublish={vi.fn()}
          onOpenDomainDialog={vi.fn()}
        />
      </div>
    );

    const trigger = screen.getByRole("button", { name: /Publish/i });
    await user.click(trigger);

    await user.click(screen.getByRole("button", { name: /Copy live URL/i }));
    expect(writeText).toHaveBeenCalledWith("http://demo-app.localhost:3000");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: /Publishing controls/i })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    expect(screen.getByRole("region", { name: /Publishing controls/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("region", { name: /Publishing controls/i })).not.toBeInTheDocument();
  });

  // covers: AC-6, AC-10
  it("submits subdomain and custom domain forms, renders apex A records, copies DNS values, and shows loading/error states", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const onUpdateSubdomain = vi.fn().mockResolvedValue(true);
    const onSaveCustomDomain = vi.fn().mockResolvedValue(true);
    const onOpenChange = vi.fn();

    const apexDomain: ProjectDomainSummary = {
      ...baseDomain,
      customDomain: "example.com",
      recordType: "apex",
      verificationToken: "spark-verify=apex123",
      verificationStatus: "failed",
      sslStatus: "unconfigured",
      failureReason: "TXT record not found",
    };

    const { rerender } = render(
      <CustomDomainDialog
        open={true}
        onOpenChange={onOpenChange}
        domain={apexDomain}
        dnsInstructions={null}
        isUpdating={false}
        isVerifying={false}
        error="Subdomain already taken"
        onUpdateSubdomain={onUpdateSubdomain}
        onSaveCustomDomain={onSaveCustomDomain}
        onVerifyDomain={vi.fn().mockResolvedValue(true)}
        onRemoveCustomDomain={vi.fn().mockResolvedValue(true)}
      />
    );

    expect(screen.getByText("Subdomain already taken")).toBeInTheDocument();
    expect(screen.getByText("TXT record not found")).toBeInTheDocument();
    expect(screen.getByText("DNS: failed")).toBeInTheDocument();
    expect(screen.getByText("SSL: unconfigured")).toBeInTheDocument();
    expect(screen.getByText("@")).toBeInTheDocument();
    expect(screen.getByText("192.0.2.1")).toBeInTheDocument();

    const subInput = screen.getByLabelText("Platform Subdomain");
    await user.clear(subInput);
    await user.type(subInput, "  new-sub  ");
    await user.click(screen.getByRole("button", { name: "Update" }));
    expect(onUpdateSubdomain).toHaveBeenCalledWith("new-sub");

    const customInput = screen.getByLabelText("Custom Domain");
    await user.clear(customInput);
    await user.type(customInput, "shop.example.com");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(onSaveCustomDomain).toHaveBeenCalledWith("shop.example.com");

    await user.click(screen.getByRole("button", { name: "Copy TXT value" }));
    expect(writeText).toHaveBeenCalledWith("spark-verify=apex123");

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(
      <CustomDomainDialog
        open={true}
        onOpenChange={onOpenChange}
        domain={apexDomain}
        dnsInstructions={null}
        isUpdating={true}
        isVerifying={true}
        error={null}
        onUpdateSubdomain={onUpdateSubdomain}
        onSaveCustomDomain={onSaveCustomDomain}
        onVerifyDomain={vi.fn().mockResolvedValue(true)}
        onRemoveCustomDomain={vi.fn().mockResolvedValue(true)}
      />
    );
    expect(screen.getByLabelText("Platform Subdomain")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Checking/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Remove custom domain/i })).toBeDisabled();
  });
});

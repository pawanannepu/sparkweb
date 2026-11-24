import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  BranchSwitcher,
  CodeDiffViewer,
  CreateBranchDialog,
  CreateCheckpointDialog,
  InspectModeBanner,
  VersionHistoryDrawer,
} from "./index";

describe("Version History and Branching UI Components", () => {
  it("renders BranchSwitcher with active branch name and triggers callbacks (AC-4)", async () => {
    const branches = [
      {
        id: "b1",
        projectId: "p1",
        name: "main",
        headSnapshotId: "s1",
        isMain: true,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "b2",
        projectId: "p1",
        name: "feature-auth",
        headSnapshotId: "s2",
        isMain: false,
        isActive: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const onSwitch = vi.fn();
    const onCreate = vi.fn();

    render(
      <BranchSwitcher
        branches={branches}
        activeBranchId="b1"
        onSwitchBranch={onSwitch}
        onCreateBranchClick={onCreate}
      />
    );

    expect(screen.getByText("main")).toBeDefined();
    const trigger = screen.getByRole("button", { name: "Switch active branch" });
    await userEvent.click(trigger);

    expect(screen.getByText("feature-auth")).toBeDefined();
    expect(screen.getByText("Create new branch...")).toBeDefined();

    await userEvent.click(screen.getByText("feature-auth"));
    expect(onSwitch).toHaveBeenCalledWith("b2");
  });

  it("renders CreateBranchDialog and validates branch name format (AC-4)", () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    render(
      <CreateBranchDialog
        isOpen={true}
        onClose={onClose}
        onSubmit={onSubmit}
        fromSnapshotId="snap-12345678"
      />
    );

    expect(screen.getByText("Create New Branch")).toBeDefined();
    expect(screen.getByText(/Branching from historical snapshot/)).toBeDefined();

    const input = screen.getByLabelText("Branch Name");
    fireEvent.change(input, { target: { value: "New Experiment" } });

    const submitBtn = screen.getByRole("button", { name: "Create Branch" });
    fireEvent.click(submitBtn);

    expect(onSubmit).toHaveBeenCalledWith("new-experiment", true);
  });

  it("renders CreateCheckpointDialog and submits message and tag (AC-5)", () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    render(<CreateCheckpointDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    expect(screen.getByText("Save Manual Checkpoint")).toBeDefined();

    const msgInput = screen.getByLabelText("Checkpoint Summary");
    const tagInput = screen.getByLabelText("Release Tag (Optional)");

    fireEvent.change(msgInput, { target: { value: "Before auth refactor" } });
    fireEvent.change(tagInput, { target: { value: "v1.1" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Checkpoint" }));
    expect(onSubmit).toHaveBeenCalledWith("Before auth refactor", "v1.1");
  });

  it("renders InspectModeBanner with snapshot details and action buttons (AC-6)", () => {
    const onRestore = vi.fn();
    const onBranch = vi.fn();
    const onExit = vi.fn();

    render(
      <InspectModeBanner
        snapshotId="12345678-abcd-ef01-2345-6789abcdef01"
        snapshotMessage="Test checkpoint"
        onRestore={onRestore}
        onBranchFromHere={onBranch}
        onExit={onExit}
      />
    );

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/Inspecting historical snapshot/)).toBeDefined();
    expect(screen.getByText("Read only preview")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Restore version" }));
    expect(onRestore).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Branch" }));
    expect(onBranch).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Exit inspect mode" }));
    expect(onExit).toHaveBeenCalled();
  });

  it("renders CodeDiffViewer with hunk lines and view toggling (AC-3)", () => {
    const diffResult = {
      baseSnapshotId: "base-1",
      targetSnapshotId: "target-2",
      summary: {
        totalFiles: 1,
        addedFiles: 0,
        modifiedFiles: 1,
        deletedFiles: 0,
        totalAdditions: 1,
        totalDeletions: 1,
      },
      fileDiffs: [
        {
          path: "src/App.tsx",
          status: "modified" as const,
          isBinary: false,
          additions: 1,
          deletions: 1,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ["-old text", "+new text"],
            },
          ],
        },
      ],
    };

    render(<CodeDiffViewer diffResult={diffResult} />);

    expect(screen.getByText("1 file changed")).toBeDefined();
    expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-1").length).toBeGreaterThan(0);
    expect(screen.getByText("old text")).toBeDefined();
    expect(screen.getByText("new text")).toBeDefined();

    // Toggle split mode
    fireEvent.click(screen.getByRole("button", { name: "Split diff view" }));
    expect(screen.getByText("Split")).toBeDefined();
  });

  it("renders VersionHistoryDrawer with grouped timeline and trigger filters (AC-5)", () => {
    const snapshots = [
      {
        id: "snap-1",
        projectId: "p1",
        parentId: null,
        branchId: "b1",
        branchName: "main",
        treeHash: "h1",
        fileCount: 4,
        message: "Initial generation",
        trigger: "generation" as const,
        tag: "v1.0",
        restoredFromSnapshotId: null,
        createdAt: new Date().toISOString(),
      },
    ];

    const onInspect = vi.fn();
    const onRollback = vi.fn();
    const onBranch = vi.fn();

    render(
      <VersionHistoryDrawer
        isOpen={true}
        onClose={vi.fn()}
        snapshots={snapshots}
        onInspectSnapshot={onInspect}
        onExitInspect={vi.fn()}
        onRollbackSnapshot={onRollback}
        onBranchFromSnapshot={onBranch}
        onSaveCheckpoint={vi.fn()}
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        selectedTriggerFilter="all"
        onTriggerFilterChange={vi.fn()}
      />
    );

    expect(screen.getByText("Version History")).toBeDefined();
    expect(screen.getByText("Initial generation")).toBeDefined();
    expect(screen.getByText("v1.0")).toBeDefined();
    expect(screen.getByText("4 files")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(onInspect).toHaveBeenCalledWith("snap-1");
  });

  it("renders empty state in VersionHistoryDrawer when no snapshots match (AC-5)", () => {
    render(
      <VersionHistoryDrawer
        isOpen={true}
        onClose={vi.fn()}
        snapshots={[]}
        onInspectSnapshot={vi.fn()}
        onExitInspect={vi.fn()}
        onRollbackSnapshot={vi.fn()}
        onBranchFromSnapshot={vi.fn()}
        onSaveCheckpoint={vi.fn()}
        searchQuery="non-existent"
        onSearchQueryChange={vi.fn()}
        selectedTriggerFilter="all"
        onTriggerFilterChange={vi.fn()}
      />
    );

    expect(screen.getByText("No snapshots found")).toBeDefined();
    expect(
      screen.getByText("Snapshots are recorded automatically as you generate or edit code.")
    ).toBeDefined();
  });

  it("renders binary file indicator in CodeDiffViewer (AC-3)", () => {
    const binaryDiff = {
      baseSnapshotId: "base-1",
      targetSnapshotId: "target-2",
      summary: {
        totalFiles: 1,
        addedFiles: 0,
        modifiedFiles: 1,
        deletedFiles: 0,
        totalAdditions: 0,
        totalDeletions: 0,
      },
      fileDiffs: [
        {
          path: "public/logo.png",
          status: "modified" as const,
          isBinary: true,
          additions: 0,
          deletions: 0,
          hunks: [],
        },
      ],
    };

    render(<CodeDiffViewer diffResult={binaryDiff} />);
    expect(screen.getByText("Binary file change. Text diff preview not available.")).toBeDefined();
  });
});

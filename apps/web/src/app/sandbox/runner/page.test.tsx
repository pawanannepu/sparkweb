import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock @spark/sandbox runner
vi.mock("@spark/sandbox", () => ({
  WebContainerRunner: class {
    getStatus() {
      return "idle";
    }
    getUrl() {
      return null;
    }
    async boot() {
      return "http://localhost:3000";
    }
    async applyFileUpdates() {}
  },
}));

import SandboxRunnerPage from "./page";

describe("SandboxRunnerPage", () => {
  // covers: AC-7
  it("renders runner shell with title, runtime descriptor, and status badge", () => {
    // Arrange & Act
    render(<SandboxRunnerPage />);

    // Assert
    expect(screen.getByText("Sparkweb Sandbox")).toBeInTheDocument();
    expect(screen.getByText("WebAssembly Node.js Runtime")).toBeInTheDocument();
    expect(screen.getByText("Terminal Output")).toBeInTheDocument();
    expect(screen.getByText("Waiting for process logs...")).toBeInTheDocument();
  });

  // covers: AC-4, AC-7
  it("renders idle status badge and loader text initially", () => {
    // Arrange & Act
    render(<SandboxRunnerPage />);

    // Assert
    expect(screen.getByText("idle")).toBeInTheDocument();
    expect(screen.getByText("Initializing preview environment...")).toBeInTheDocument();
    expect(screen.getByText("Vite dev server starting in browser WebAssembly")).toBeInTheDocument();
  });
});

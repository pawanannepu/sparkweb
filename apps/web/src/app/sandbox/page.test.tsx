import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import SandboxPage from "./page";

describe("SandboxPage component", () => {
  it("renders runner heading and cross origin policy text (covers: AC-2)", () => {
    // Arrange & Act
    render(<SandboxPage />);

    // Assert
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /Isolated Sandbox Preview Runner/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/Cross-Origin-Embedder-Policy: credentialless/i)).toBeInTheDocument();
  });

  it("renders explanation regarding WebContainer isolation", () => {
    // Arrange & Act
    render(<SandboxPage />);

    // Assert
    expect(
      screen.getByText(/This runner executes inside dedicated cross origin headers/i)
    ).toBeInTheDocument();
  });
});

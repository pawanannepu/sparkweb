import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "./page";

describe("HomePage component", () => {
  it("renders primary headline and scaffold status badge (covers: AC-1)", () => {
    // Arrange & Act
    render(<HomePage />);

    // Assert
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Build full stack applications from natural language/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/sparkweb scaffold ready/i)).toBeInTheDocument();
  });

  it("renders technology foundation overview cards", () => {
    // Arrange & Act
    render(<HomePage />);

    // Assert
    expect(
      screen.getByRole("heading", { level: 3, name: /Next\.js App Router/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /Sandbox Runner/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /Database Layer/i })).toBeInTheDocument();
  });

  it("renders architectural stack description paragraph", () => {
    // Arrange & Act
    render(<HomePage />);

    // Assert
    expect(
      screen.getByText(/In browser WebContainers, WASM PostgreSQL with PGlite/i)
    ).toBeInTheDocument();
  });
});

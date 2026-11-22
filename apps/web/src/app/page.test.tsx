import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import BuilderPage from "./page";

describe("BuilderPage Component", () => {
  it("renders studio shell with project title and prompt assistant", () => {
    render(<BuilderPage />);

    expect(screen.getByText("sparkweb")).toBeInTheDocument();
    expect(screen.getByText("Demo Application")).toBeInTheDocument();
    expect(screen.getAllByText("Prompt Assistant").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Welcome to sparkweb/i).length).toBeGreaterThan(0);
  });

  it("renders live preview toolbar and device switcher controls", () => {
    render(<BuilderPage />);

    expect(screen.getAllByLabelText("Desktop viewport").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Tablet viewport").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Mobile viewport").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Preview address bar").length).toBeGreaterThan(0);
  });

  it("allows user to type a prompt and submit via composer", async () => {
    render(<BuilderPage />);

    const textareas = screen.getAllByPlaceholderText(/Describe the application or component/i);
    const textarea = textareas[0];
    if (!textarea) throw new Error("Textarea element not found");

    fireEvent.change(textarea, { target: { value: "Build a customer feedback form" } });

    const generateButtons = screen.getAllByRole("button", { name: /generate/i });
    const generateBtn = generateButtons[0];
    if (!generateBtn) throw new Error("Generate button not found");
    fireEvent.click(generateBtn);

    expect(screen.getAllByText("Build a customer feedback form").length).toBeGreaterThan(0);
  });
});

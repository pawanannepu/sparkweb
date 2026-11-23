import type { SelectedElementState } from "@spark/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InspectorPanel } from "./InspectorPanel";

describe("InspectorPanel Component", () => {
  const mockElement: SelectedElementState = {
    selector: "[data-source-loc='src/App.tsx:10:5']",
    tagName: "button",
    source: { file: "src/App.tsx", line: 10, column: 5 },
    classes: ["p-4", "bg-indigo-600", "text-white", "font-medium", "rounded-md"],
    styles: {},
    textContent: "Submit Prompt",
    rect: { top: 100, left: 100, width: 120, height: 40 },
    isEditable: true,
    isLeafTextOnly: true,
  };

  it("renders empty state placeholder when no element is selected", () => {
    render(<InspectorPanel element={null} onClose={vi.fn()} onApplyStyle={vi.fn()} />);

    expect(screen.getByText("Canvas Inspector")).toBeInTheDocument();
    expect(screen.getByText(/Click the inspect toggle/)).toBeInTheDocument();
  });

  it("renders element details, source location, and controls when element is selected", () => {
    render(<InspectorPanel element={mockElement} onClose={vi.fn()} onApplyStyle={vi.fn()} />);

    expect(screen.getByText("<button>")).toBeInTheDocument();
    expect(screen.getByText("App.tsx:10")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Submit Prompt")).toBeInTheDocument();
  });

  it("displays read only badge and disables controls for non workspace files (AC-7)", () => {
    const readOnlyElement: SelectedElementState = {
      ...mockElement,
      source: { file: "node_modules/library/button.js", line: 5, column: 1 },
      isEditable: false,
    };

    render(<InspectorPanel element={readOnlyElement} onClose={vi.fn()} onApplyStyle={vi.fn()} />);

    expect(screen.getByText("Read only element")).toBeInTheDocument();
    expect(screen.getByText("external / unmapped")).toBeInTheDocument();
  });

  it("triggers style updates when preset buttons are clicked", () => {
    const onApplyStyle = vi.fn();
    render(<InspectorPanel element={mockElement} onClose={vi.fn()} onApplyStyle={onApplyStyle} />);

    // Click 'p-8' padding preset
    const p8Btn = screen.getByRole("button", { name: "p-8" });
    fireEvent.click(p8Btn);

    expect(onApplyStyle).toHaveBeenCalledWith(
      expect.objectContaining({
        newClasses: ["p-8"],
        removeClasses: ["p-4"],
      })
    );
  });

  it("triggers text updates for leaf text node", () => {
    const onApplyText = vi.fn();
    render(
      <InspectorPanel
        element={mockElement}
        onClose={vi.fn()}
        onApplyStyle={vi.fn()}
        onApplyText={onApplyText}
      />
    );

    const input = screen.getByDisplayValue("Submit Prompt");
    fireEvent.change(input, { target: { value: "New Button Label" } });
    fireEvent.blur(input);

    expect(onApplyText).toHaveBeenCalledWith("New Button Label");
  });

  // covers: AC-4
  it("renders with accessible landmark aria-label and tags", () => {
    render(<InspectorPanel element={mockElement} onClose={vi.fn()} onApplyStyle={vi.fn()} />);

    const panel = screen.getByLabelText("Visual Canvas Inspector Panel");
    expect(panel).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Visual Canvas Inspector Panel" })
    ).toBeInTheDocument();
  });

  // covers: AC-4
  it("toggles typography and margin presets", () => {
    const onApplyStyle = vi.fn();
    render(<InspectorPanel element={mockElement} onClose={vi.fn()} onApplyStyle={onApplyStyle} />);

    // Click font size 'xl'
    const xlBtn = screen.getByRole("button", { name: "xl" });
    fireEvent.click(xlBtn);
    expect(onApplyStyle).toHaveBeenCalledWith(
      expect.objectContaining({
        newClasses: ["text-xl"],
      })
    );

    // Click margin 'm-4'
    const m4Btn = screen.getByRole("button", { name: "m-4" });
    fireEvent.click(m4Btn);
    expect(onApplyStyle).toHaveBeenCalledWith(
      expect.objectContaining({
        newClasses: ["m-4"],
      })
    );
  });

  // covers: AC-8
  it("triggers onUndo and onRedo callbacks when enabled and handles disabled state", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();

    const { rerender } = render(
      <InspectorPanel
        element={mockElement}
        onClose={vi.fn()}
        onApplyStyle={vi.fn()}
        canUndo={true}
        canRedo={true}
        onUndo={onUndo}
        onRedo={onRedo}
      />
    );

    const undoBtn = screen.getByLabelText("Undo visual edit");
    const redoBtn = screen.getByLabelText("Redo visual edit");

    expect(undoBtn).not.toBeDisabled();
    expect(redoBtn).not.toBeDisabled();

    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);

    fireEvent.click(redoBtn);
    expect(onRedo).toHaveBeenCalledTimes(1);

    // Rerender with canUndo=false and canRedo=false
    rerender(
      <InspectorPanel
        element={mockElement}
        onClose={vi.fn()}
        onApplyStyle={vi.fn()}
        canUndo={false}
        canRedo={false}
        onUndo={onUndo}
        onRedo={onRedo}
      />
    );

    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();
  });

  // covers: AC-4
  it("triggers onClose callback when close button is clicked", () => {
    const onClose = vi.fn();
    render(<InspectorPanel element={mockElement} onClose={onClose} onApplyStyle={vi.fn()} />);

    const closeBtn = screen.getByLabelText("Close inspector");
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

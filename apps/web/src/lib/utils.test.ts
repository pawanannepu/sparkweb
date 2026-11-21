import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn utility", () => {
  it("merges single class name strings", () => {
    // Arrange & Act
    const result = cn("px-4 py-2 bg-blue-500");

    // Assert
    expect(result).toBe("px-4 py-2 bg-blue-500");
  });

  it("merges multiple class name arguments", () => {
    // Arrange & Act
    const result = cn("font-bold", "text-white", "rounded-lg");

    // Assert
    expect(result).toBe("font-bold text-white rounded-lg");
  });

  it("resolves conflicting tailwind utility classes with twMerge precedence", () => {
    // Arrange & Act - later padding overrides earlier padding
    const result = cn("p-4", "p-2", "text-red-500", "text-blue-500");

    // Assert
    expect(result).toBe("p-2 text-blue-500");
  });

  it("handles conditional falsy expressions and empty inputs cleanly", () => {
    // Arrange
    const isPrimary = false;
    const isSecondary = true;

    // Act
    const result = cn(
      "base-class",
      isPrimary && "bg-primary",
      isSecondary && "bg-secondary",
      null,
      undefined,
      ""
    );

    // Assert
    expect(result).toBe("base-class bg-secondary");
  });

  it("supports arrays and objects passed as class inputs", () => {
    // Arrange & Act
    const result = cn(["flex", "items-center"], { "opacity-50": true, hidden: false });

    // Assert
    expect(result).toBe("flex items-center opacity-50");
  });
});

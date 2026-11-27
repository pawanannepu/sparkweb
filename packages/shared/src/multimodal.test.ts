import { describe, expect, it } from "vitest";
import {
  DEFAULT_MULTIMODAL_PROMPT,
  type DesignOutlinePayload,
  DesignOutlinePayloadSchema,
  formatConfirmedOutlineForPrompt,
  getEffectiveOutlinePayload,
  HexColorSchema,
  normalizeHexColor,
  UrlSnapshotSchema,
} from "./multimodal";

function createSampleOutline(overrides?: Partial<DesignOutlinePayload>): DesignOutlinePayload {
  return {
    appSummary: "Habit tracker with streak calendar",
    palette: [
      { id: "pal-1", role: "Primary", hex: "#2563EB", usage: "Primary buttons" },
      { id: "pal-2", role: "Accent", hex: "#10B981", usage: "Streak badges" },
    ],
    typography: {
      headingFont: "Plus Jakarta Sans",
      bodyFont: "Inter",
      monoFont: "JetBrains Mono",
      scaleNotes: "Tight display headings, 16px body",
    },
    layoutSections: [
      { id: "sec-1", name: "Header", description: "Top navigation", enabled: true },
      { id: "sec-2", name: "Hero", description: "Daily check in banner", enabled: false },
      { id: "sec-3", name: "Calendar", description: "Monthly heatmap", enabled: true },
    ],
    componentHierarchy: [
      { id: "comp-1", name: "AppShell", role: "Root shell", enabled: true },
      {
        id: "comp-2",
        name: "DisabledWidget",
        role: "Hidden widget",
        parentId: "comp-1",
        enabled: false,
      },
      {
        id: "comp-3",
        name: "StreakGrid",
        role: "Calendar grid",
        parentId: "comp-1",
        enabled: true,
      },
      {
        id: "comp-4",
        name: "OrphanChild",
        role: "Child whose parent is disabled",
        parentId: "comp-2",
        enabled: true,
      },
    ],
    additionalNotes: "Keep dark surface contrast high.",
    ...overrides,
  };
}

describe("multimodal shared contracts and helpers", () => {
  // covers: AC-2, AC-8
  it("validates hex color tokens and normalizes short hex codes", () => {
    expect(HexColorSchema.parse(" #2563eb ")).toBe("#2563eb");
    expect(HexColorSchema.parse("#abc")).toBe("#abc");
    expect(HexColorSchema.parse("#11223380")).toBe("#11223380");
    expect(() => HexColorSchema.parse("blue")).toThrow();
    expect(() => HexColorSchema.parse("#12")).toThrow();

    expect(normalizeHexColor(" #abc ")).toBe("#AABBCC");
    expect(normalizeHexColor("#2563ebff")).toBe("#2563EB");
  });

  // covers: AC-6, AC-8
  it("validates design outline payloads and url snapshots against schema bounds", () => {
    const valid = createSampleOutline();
    expect(DesignOutlinePayloadSchema.parse(valid)).toEqual(valid);

    expect(() =>
      DesignOutlinePayloadSchema.parse({
        ...valid,
        palette: [],
      })
    ).toThrow();

    expect(() =>
      DesignOutlinePayloadSchema.parse({
        ...valid,
        layoutSections: [],
      })
    ).toThrow();

    const snap = UrlSnapshotSchema.parse({
      title: "Acme App",
      headings: ["Hero", "Pricing"],
      colors: ["#2563EB"],
      fonts: ["Inter"],
      landmarkCount: 3,
    });
    expect(snap.title).toBe("Acme App");
    expect(() =>
      UrlSnapshotSchema.parse({
        title: "Bad",
        headings: [],
        colors: [],
        fonts: [],
        landmarkCount: -1,
      })
    ).toThrow();
  });

  // covers: AC-2, AC-8
  it("selects editedOutline over extractedOutline when present", () => {
    const extracted = createSampleOutline({ appSummary: "Extracted summary" });
    const edited = createSampleOutline({ appSummary: "Edited summary" });

    expect(
      getEffectiveOutlinePayload({ extractedOutline: extracted, editedOutline: null }).appSummary
    ).toBe("Extracted summary");
    expect(
      getEffectiveOutlinePayload({ extractedOutline: extracted, editedOutline: edited }).appSummary
    ).toBe("Edited summary");
    expect(DEFAULT_MULTIMODAL_PROMPT).toContain("design reference");
  });

  // covers: AC-9
  it("formats confirmed outline prompt context excluding disabled sections and components", () => {
    const payload = createSampleOutline();
    const formatted = formatConfirmedOutlineForPrompt(payload);

    expect(formatted).toContain("Summary: Habit tracker with streak calendar");
    expect(formatted).toContain("- Primary: #2563EB (Primary buttons)");
    expect(formatted).toContain("Heading Font: Plus Jakarta Sans");
    expect(formatted).toContain("Mono Font: JetBrains Mono");

    expect(formatted).toContain("Enabled Layout Sections (2):");
    expect(formatted).toContain("- Header: Top navigation");
    expect(formatted).toContain("- Calendar: Monthly heatmap");
    expect(formatted).not.toContain("Hero");

    expect(formatted).toContain("Enabled Component Hierarchy (3):");
    expect(formatted).toContain("- StreakGrid (inside AppShell): Calendar grid");
    expect(formatted).not.toContain("DisabledWidget");
    // Parent comp-2 is disabled, so OrphanChild should omit "(inside DisabledWidget)"
    expect(formatted).toContain("- OrphanChild: Child whose parent is disabled");
    expect(formatted).not.toContain("inside DisabledWidget");

    expect(formatted).toContain("Additional Creator Notes:\nKeep dark surface contrast high.");
  });

  // covers: AC-9
  it("handles outlines where all sections and components are disabled and notes are blank", () => {
    const payload = createSampleOutline({
      typography: {
        headingFont: "Inter",
        bodyFont: "Inter",
        scaleNotes: "Simple",
      },
      layoutSections: [{ id: "sec-1", name: "Header", description: "Nav", enabled: false }],
      componentHierarchy: [{ id: "comp-1", name: "AppShell", role: "Shell", enabled: false }],
      additionalNotes: "   ",
    });

    const formatted = formatConfirmedOutlineForPrompt(payload);
    expect(formatted).toContain("Enabled Layout Sections (0):\n- None selected");
    expect(formatted).toContain("Enabled Component Hierarchy (0):\n- None selected");
    expect(formatted).not.toContain("Mono Font:");
    expect(formatted).not.toContain("Additional Creator Notes:");
  });
});

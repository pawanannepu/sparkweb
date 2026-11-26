import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ApiKeysDialog } from "./ApiKeysDialog";

describe("ApiKeysDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders OpenRouter section and saves a key", async () => {
    const onSaveKey = vi.fn().mockResolvedValue({
      provider: "openrouter",
      keyHint: "sk-or-...4321",
      updatedAt: "2026-11-26T00:00:00.000Z",
    });
    const onRemoveKey = vi.fn().mockResolvedValue(undefined);

    render(
      <ApiKeysDialog
        open={true}
        onOpenChange={vi.fn()}
        configuredKeys={[]}
        envProviders={[]}
        onSaveKey={onSaveKey}
        onRemoveKey={onRemoveKey}
      />
    );

    const input = screen.getByLabelText("OpenRouter API key");
    fireEvent.change(input, { target: { value: "sk-or-v1-my-secret-4321" } });

    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    const openRouterSave = saveButtons[0];
    if (!openRouterSave) throw new Error("Save button not found");
    fireEvent.click(openRouterSave);

    await waitFor(() => {
      expect(onSaveKey).toHaveBeenCalledWith("openrouter", "sk-or-v1-my-secret-4321");
    });
    expect(screen.getByText(/Saved openrouter key \(sk-or-\.\.\.4321\)/i)).toBeInTheDocument();
  });

  it("renders saved key hint and allows removing it", async () => {
    const onSaveKey = vi.fn();
    const onRemoveKey = vi.fn().mockResolvedValue(undefined);

    render(
      <ApiKeysDialog
        open={true}
        onOpenChange={vi.fn()}
        configuredKeys={[
          {
            provider: "openrouter",
            keyHint: "sk-or-...8888",
            updatedAt: "2026-11-26T00:00:00.000Z",
          },
        ]}
        envProviders={[]}
        onSaveKey={onSaveKey}
        onRemoveKey={onRemoveKey}
      />
    );

    expect(screen.getByText("sk-or-...8888")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove OpenRouter API key"));

    await waitFor(() => {
      expect(onRemoveKey).toHaveBeenCalledWith("openrouter");
    });
  });
});

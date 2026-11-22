import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebContainerRunner } from "./runner";

// Mock @webcontainer/api
const mockMount = vi.fn();
const mockSpawn = vi.fn();
const mockMkdir = vi.fn();
const mockWriteFile = vi.fn();
const mockRm = vi.fn();
const mockOn = vi.fn();

const mockContainer = {
  mount: mockMount,
  spawn: mockSpawn,
  fs: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    rm: mockRm,
  },
  on: mockOn,
};

vi.mock("@webcontainer/api", () => ({
  WebContainer: {
    boot: vi.fn(async () => mockContainer),
  },
}));

describe("WebContainerRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // covers: AC-3
  it("initializes with idle status and null url", () => {
    // Arrange & Act
    const runner = new WebContainerRunner();

    // Assert
    expect(runner.getStatus()).toBe("idle");
    expect(runner.getUrl()).toBeNull();
  });

  // covers: AC-4
  it("throws when applyFileUpdates is called before container is booted", async () => {
    // Arrange
    const runner = new WebContainerRunner();

    // Act & Assert
    await expect(
      runner.applyFileUpdates([{ path: "src/App.tsx", content: "export default () => {}" }])
    ).rejects.toThrow("WebContainer has not been booted yet.");
  });

  // covers: AC-4
  it("writes files and creates parent directories when container is booted", async () => {
    // Arrange
    const onLog = vi.fn();
    const runner = new WebContainerRunner({ onLog });

    // Boot container using mocked spawn process
    const mockInstallProcess = {
      output: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      exit: Promise.resolve(0),
    };
    const mockDevProcess = {
      output: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    };

    mockSpawn.mockResolvedValueOnce(mockInstallProcess).mockResolvedValueOnce(mockDevProcess);

    mockOn.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
      if (event === "server-ready") {
        setTimeout(() => callback(3000, "http://localhost:3000"), 10);
      }
    });

    await runner.boot();

    // Act
    await runner.applyFileUpdates([
      { path: "src/components/Header.tsx", content: "export const Header = () => null;" },
      { path: "index.html", content: "<!DOCTYPE html>" },
    ]);

    // Assert
    expect(mockMkdir).toHaveBeenCalledWith("src/components", { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      "src/components/Header.tsx",
      "export const Header = () => null;"
    );
    expect(mockWriteFile).toHaveBeenCalledWith("index.html", "<!DOCTYPE html>");
    expect(onLog).toHaveBeenCalledWith("Updated virtual file: src/components/Header.tsx");
  });

  // covers: AC-4
  it("removes virtual file via removeFile", async () => {
    // Arrange
    const onLog = vi.fn();
    const runner = new WebContainerRunner({ onLog });

    const mockInstallProcess = {
      output: new ReadableStream({ start: (c) => c.close() }),
      exit: Promise.resolve(0),
    };
    const mockDevProcess = {
      output: new ReadableStream({ start: (c) => c.close() }),
    };

    mockSpawn.mockResolvedValueOnce(mockInstallProcess).mockResolvedValueOnce(mockDevProcess);

    mockOn.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
      if (event === "server-ready") {
        setTimeout(() => callback(3000, "http://localhost:3000"), 10);
      }
    });

    await runner.boot();

    // Act
    await runner.removeFile("src/old.ts");

    // Assert
    expect(mockRm).toHaveBeenCalledWith("src/old.ts");
    expect(onLog).toHaveBeenCalledWith("Deleted virtual file: src/old.ts");
  });

  // covers: AC-8
  it("emits onError callback when container fails to boot", async () => {
    // Arrange
    const onError = vi.fn();
    const runner = new WebContainerRunner({ onError });

    const mockInstallProcess = {
      output: new ReadableStream({ start: (c) => c.close() }),
      exit: Promise.resolve(1), // npm install error
    };

    mockSpawn.mockResolvedValueOnce(mockInstallProcess);

    // Act & Assert
    await expect(runner.boot()).rejects.toThrow("npm install failed with exit code 1");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "npm install failed with exit code 1",
      })
    );
    expect(runner.getStatus()).toBe("error");
  });
});

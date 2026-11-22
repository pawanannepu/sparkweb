import type {
  PreviewErrorPayload,
  PreviewStatus,
  ProjectFile,
  SnapshotFilesMap,
} from "@spark/shared";
import { WebContainer, type WebContainerProcess } from "@webcontainer/api";
import {
  filterSourceFiles,
  STARTER_TEMPLATE_FILES,
  toWebContainerFileSystemTree,
} from "./template";

export interface WebContainerRunnerCallbacks {
  onStatusChange?: (status: PreviewStatus) => void;
  onReady?: (url: string) => void;
  onError?: (error: PreviewErrorPayload) => void;
  onLog?: (line: string) => void;
}

export class WebContainerRunner {
  private container: WebContainer | null = null;
  private status: PreviewStatus = "idle";
  private serverUrl: string | null = null;
  private devProcess: WebContainerProcess | null = null;
  private callbacks: WebContainerRunnerCallbacks;

  constructor(callbacks: WebContainerRunnerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public getStatus(): PreviewStatus {
    return this.status;
  }

  public getUrl(): string | null {
    return this.serverUrl;
  }

  private setStatus(status: PreviewStatus) {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  public async boot(files?: SnapshotFilesMap): Promise<string> {
    try {
      this.setStatus("booting");
      this.callbacks.onLog?.("Booting in-browser WebContainer runtime...");

      if (!this.container) {
        this.container = await WebContainer.boot();
      }

      const filesToMount = files && Object.keys(files).length > 0 ? files : STARTER_TEMPLATE_FILES;
      const cleanFiles = filterSourceFiles(filesToMount);
      const fsTree = toWebContainerFileSystemTree(cleanFiles);

      await this.container.mount(fsTree);
      this.callbacks.onLog?.("Virtual file tree mounted successfully.");

      // Install dependencies if node_modules does not exist
      this.setStatus("installing");
      this.callbacks.onLog?.("Resolving template dependencies...");

      const installProcess = await this.container.spawn("npm", ["install"]);
      installProcess.output.pipeTo(
        new WritableStream({
          write: (data) => {
            this.callbacks.onLog?.(data);
          },
        })
      );

      const installExitCode = await installProcess.exit;
      if (installExitCode !== 0) {
        throw new Error(`npm install failed with exit code ${installExitCode}`);
      }

      this.callbacks.onLog?.("Starting Vite dev server...");
      this.devProcess = await this.container.spawn("npm", ["run", "dev"]);

      this.devProcess.output.pipeTo(
        new WritableStream({
          write: (data) => {
            this.callbacks.onLog?.(data);
            this.inspectViteOutputForErrors(data);
          },
        })
      );

      return new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout waiting for preview dev server to listen on port"));
        }, 60000);

        this.container?.on("server-ready", (_port, url) => {
          clearTimeout(timeout);
          this.serverUrl = url;
          this.setStatus("running");
          this.callbacks.onReady?.(url);
          resolve(url);
        });

        this.container?.on("error", (error) => {
          clearTimeout(timeout);
          this.setStatus("error");
          this.callbacks.onError?.({ message: error.message });
          reject(error);
        });
      });
    } catch (err: unknown) {
      this.setStatus("error");
      const errorObj = err as Error;
      const errPayload: PreviewErrorPayload = {
        message: errorObj?.message || "Failed to boot WebContainer runner",
        stack: errorObj?.stack,
      };
      this.callbacks.onError?.(errPayload);
      throw err;
    }
  }

  public async applyFileUpdates(files: ProjectFile[]): Promise<void> {
    if (!this.container) {
      throw new Error("WebContainer has not been booted yet.");
    }

    for (const file of files) {
      const cleanPath = file.path.replace(/^[./]+/, "");
      const segments = cleanPath.split("/");
      if (segments.length > 1) {
        const dir = segments.slice(0, -1).join("/");
        await this.container.fs.mkdir(dir, { recursive: true });
      }

      await this.container.fs.writeFile(cleanPath, file.content);
      this.callbacks.onLog?.(`Updated virtual file: ${cleanPath}`);
    }
  }

  public async removeFile(path: string): Promise<void> {
    if (!this.container) return;
    const cleanPath = path.replace(/^[./]+/, "");
    try {
      await this.container.fs.rm(cleanPath);
      this.callbacks.onLog?.(`Deleted virtual file: ${cleanPath}`);
    } catch (err) {
      console.warn("Could not remove file", cleanPath, err);
    }
  }

  private inspectViteOutputForErrors(output: string) {
    if (
      output.includes("error") ||
      output.includes("Error:") ||
      output.includes("Failed to resolve") ||
      output.includes("SyntaxError")
    ) {
      // Extract line and column if present (e.g. at src/App.tsx:14:2)
      const match = output.match(/([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+):(\d+):(\d+)/);
      const parsedLine = match?.[2] ? parseInt(match[2], 10) : undefined;
      const parsedColumn = match?.[3] ? parseInt(match[3], 10) : undefined;
      const payload: PreviewErrorPayload = {
        message: output.trim(),
        filename: match ? match[1] : undefined,
        line: Number.isNaN(parsedLine) ? undefined : parsedLine,
        column: Number.isNaN(parsedColumn) ? undefined : parsedColumn,
      };
      this.callbacks.onError?.(payload);
    }
  }
}

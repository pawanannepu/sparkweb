import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SnapshotFilesMap } from "@spark/shared";
import { prepareProductionFiles } from "./strip-builder";
import type { BuildRunnerOptions, BuildRunnerResult } from "./types";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024; // 50 MB

export function resolveSafeTempPath(rootDir: string, relativePath: string): string {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) {
    throw new Error(`Invalid snapshot file path: ${relativePath}`);
  }
  const segments = cleaned.split("/");
  if (segments.some((seg) => seg === ".." || seg === ".")) {
    throw new Error(`Path traversal rejected: ${relativePath}`);
  }
  const resolved = path.resolve(rootDir, cleaned);
  if (resolved !== rootDir && !resolved.startsWith(`${rootDir}${path.sep}`)) {
    throw new Error(`Path escapes build root: ${relativePath}`);
  }
  return resolved;
}

export async function calculateDirectoryBytes(dirPath: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await calculateDirectoryBytes(fullPath);
    } else if (entry.isFile()) {
      const info = await stat(fullPath);
      total += info.size;
    }
  }
  return total;
}

function buildSanitizedEnv(tempHomeDir: string, npmCacheDir: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: tempHomeDir,
    NODE_ENV: "production",
    npm_config_cache: npmCacheDir,
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };
}

interface CommandOutcome {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

async function runSanitizedCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: string[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);

    child.stdout?.on("data", (data: Buffer) => {
      chunks.push(data.toString("utf-8"));
    });

    child.stderr?.on("data", (data: Buffer) => {
      chunks.push(data.toString("utf-8"));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      chunks.push(`\n[process error] ${err.message}`);
      resolve({
        exitCode: 1,
        timedOut,
        output: chunks.join(""),
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        timedOut,
        output: chunks.join(""),
      });
    });
  });
}

/**
 * Compiles a snapshot inside an isolated temporary directory with lifecycle
 * scripts disabled, builder scripts stripped, and host secrets excluded.
 */
export async function runIsolatedViteBuild(
  snapshotFiles: SnapshotFilesMap,
  options: BuildRunnerOptions = {}
): Promise<BuildRunnerResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const npmCacheDir =
    options.npmCacheDir ||
    process.env.SPARK_NPM_CACHE_DIR ||
    path.join(os.tmpdir(), "sparkweb-npm-cache");

  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sparkweb-build-"));
  const projectDir = path.join(workspaceRoot, "app");
  const tempHomeDir = path.join(workspaceRoot, "home");
  const logs: string[] = [];

  const cleanup = async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  };

  try {
    await mkdir(projectDir, { recursive: true });
    await mkdir(tempHomeDir, { recursive: true });
    await mkdir(npmCacheDir, { recursive: true });

    const productionFiles = prepareProductionFiles(snapshotFiles);

    for (const [relativePath, entry] of Object.entries(productionFiles)) {
      const targetPath = resolveSafeTempPath(projectDir, relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      if (entry.isBinary) {
        await writeFile(targetPath, Buffer.from(entry.content, "base64"));
      } else {
        await writeFile(targetPath, entry.content, "utf-8");
      }
    }

    const sanitizedEnv = buildSanitizedEnv(tempHomeDir, npmCacheDir);

    // Install dependencies + devDependencies (Vite, Tailwind, React plugin) with lifecycle scripts disabled
    logs.push("$ npm install --include=dev --ignore-scripts --no-audit --no-fund --prefer-offline");
    const installOutcome = await runSanitizedCommand(
      "npm",
      [
        "install",
        "--include=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefer-offline",
      ],
      projectDir,
      sanitizedEnv,
      timeoutMs
    );
    logs.push(installOutcome.output.trim());

    if (installOutcome.timedOut) {
      return {
        success: false,
        distDir: null,
        buildLogs: logs.join("\n"),
        durationMs: Date.now() - startedAt,
        errorMessage: "Dependency installation timed out after 120 seconds",
        cleanup,
      };
    }

    if (installOutcome.exitCode !== 0) {
      return {
        success: false,
        distDir: null,
        buildLogs: logs.join("\n"),
        durationMs: Date.now() - startedAt,
        errorMessage: `Dependency installation failed with exit code ${installOutcome.exitCode}`,
        cleanup,
      };
    }

    const elapsedInstallMs = Date.now() - startedAt;
    const remainingTimeoutMs = Math.max(5_000, timeoutMs - elapsedInstallMs);
    const viteBin = path.join(
      projectDir,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "vite.cmd" : "vite"
    );

    logs.push("\n$ vite build");
    const buildOutcome = await runSanitizedCommand(
      viteBin,
      ["build"],
      projectDir,
      sanitizedEnv,
      remainingTimeoutMs
    );
    logs.push(buildOutcome.output.trim());

    if (buildOutcome.timedOut) {
      return {
        success: false,
        distDir: null,
        buildLogs: logs.join("\n"),
        durationMs: Date.now() - startedAt,
        errorMessage: "Production Vite build timed out after 120 seconds",
        cleanup,
      };
    }

    if (buildOutcome.exitCode !== 0) {
      return {
        success: false,
        distDir: null,
        buildLogs: logs.join("\n"),
        durationMs: Date.now() - startedAt,
        errorMessage: `Vite build failed with exit code ${buildOutcome.exitCode}`,
        cleanup,
      };
    }

    const distDir = path.join(projectDir, "dist");
    if (!existsSync(distDir) || !existsSync(path.join(distDir, "index.html"))) {
      return {
        success: false,
        distDir: null,
        buildLogs: logs.join("\n"),
        durationMs: Date.now() - startedAt,
        errorMessage: "Vite build completed without producing dist/index.html",
        cleanup,
      };
    }

    const distBytes = await calculateDirectoryBytes(distDir);
    if (distBytes > maxOutputBytes) {
      return {
        success: false,
        distDir: null,
        buildLogs: logs.join("\n"),
        durationMs: Date.now() - startedAt,
        errorMessage: `Compiled output (${Math.round(distBytes / (1024 * 1024))} MB) exceeds the 50 MB limit`,
        cleanup,
      };
    }

    return {
      success: true,
      distDir,
      buildLogs: logs.join("\n"),
      durationMs: Date.now() - startedAt,
      errorMessage: null,
      cleanup,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown build error";
    logs.push(`\n[build runner exception] ${message}`);
    return {
      success: false,
      distDir: null,
      buildLogs: logs.join("\n"),
      durationMs: Date.now() - startedAt,
      errorMessage: message,
      cleanup,
    };
  }
}

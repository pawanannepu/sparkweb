// @vitest-environment node
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface SpawnCall {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

const spawnState = vi.hoisted(() => ({
  calls: [] as SpawnCall[],
  handler: null as
    | ((
        call: SpawnCall,
        emit: {
          stdout: (chunk: string) => void;
          stderr: (chunk: string) => void;
          close: (code: number | null) => void;
        }
      ) => void)
    | null,
}));

vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    const call: SpawnCall = { command, args, cwd: options.cwd, env: options.env };
    spawnState.calls.push(call);

    queueMicrotask(() => {
      if (spawnState.handler) {
        spawnState.handler(call, {
          stdout: (chunk) => child.stdout.emit("data", Buffer.from(chunk)),
          stderr: (chunk) => child.stderr.emit("data", Buffer.from(chunk)),
          close: (code) => child.emit("close", code),
        });
      }
    });

    return child;
  },
}));

import { runIsolatedViteBuild } from "./build-runner";

describe("runIsolatedViteBuild", () => {
  beforeEach(() => {
    spawnState.calls = [];
    spawnState.handler = null;
  });

  // covers: AC-3
  it("strips host secrets, disables lifecycle scripts, builds dist/index.html, and cleans up", async () => {
    process.env.TEST_HOST_SECRET = "do-not-leak";
    spawnState.handler = async (call, emit) => {
      if (call.command === "npm") {
        emit.stdout("added 10 packages");
        emit.close(0);
        return;
      }
      const distDir = path.join(call.cwd, "dist");
      await mkdir(distDir, { recursive: true });
      await writeFile(path.join(distDir, "index.html"), "<html>ok</html>", "utf-8");
      emit.stdout("vite built dist/index.html");
      emit.close(0);
    };

    const result = await runIsolatedViteBuild({
      "package.json": { content: '{"name":"demo"}' },
      "src/main.tsx": {
        content: 'import "./spark-inspector-client";\nconsole.log("app");',
      },
      "src/spark-inspector-client.ts": { content: "export {};" },
    });

    try {
      expect(result.success).toBe(true);
      expect(result.distDir).toBeTruthy();
      expect(result.buildLogs).toContain("added 10 packages");
      expect(result.buildLogs).toContain("vite built dist/index.html");

      expect(spawnState.calls).toHaveLength(2);
      const installCall = spawnState.calls[0];
      expect(installCall?.args).toContain("--ignore-scripts");
      expect(installCall?.env.TEST_HOST_SECRET).toBeUndefined();
      expect(installCall?.env.NODE_ENV).toBe("production");
      expect(existsSync(path.join(installCall?.cwd ?? "", "src/spark-inspector-client.ts"))).toBe(
        false
      );
    } finally {
      delete process.env.TEST_HOST_SECRET;
      await result.cleanup();
    }
  });

  // covers: AC-3
  it("fails when npm install exits non-zero without invoking vite build", async () => {
    spawnState.handler = (_call, emit) => {
      emit.stderr("ERR! ERESOLVE");
      emit.close(1);
    };

    const result = await runIsolatedViteBuild({
      "package.json": { content: '{"name":"demo"}' },
    });

    try {
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("Dependency installation failed");
      expect(result.buildLogs).toContain("ERR! ERESOLVE");
      expect(spawnState.calls).toHaveLength(1);
    } finally {
      await result.cleanup();
    }
  });

  // covers: AC-3
  it("fails when vite build fails or exceeds the maxOutputBytes cap", async () => {
    spawnState.handler = async (call, emit) => {
      if (call.command === "npm") {
        emit.close(0);
        return;
      }
      const distDir = path.join(call.cwd, "dist");
      await mkdir(distDir, { recursive: true });
      await writeFile(path.join(distDir, "index.html"), "<html>too large</html>", "utf-8");
      await writeFile(path.join(distDir, "bundle.js"), "x".repeat(200), "utf-8");
      emit.close(0);
    };

    const oversized = await runIsolatedViteBuild(
      { "package.json": { content: '{"name":"demo"}' } },
      { maxOutputBytes: 50 }
    );

    try {
      expect(oversized.success).toBe(false);
      expect(oversized.errorMessage).toContain("exceeds the 50 MB limit");
    } finally {
      await oversized.cleanup();
    }
  });
});

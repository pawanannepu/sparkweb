import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDatabaseViewer } from "./useDatabaseViewer";

describe("useDatabaseViewer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ queries: [] }),
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stays in BOOTING without flashing a timeout error before DB_READY_EVENT arrives (AC-9)", async () => {
    const sendToPreview = vi.fn();
    const { result, rerender } = renderHook(
      ({ isConnected }) =>
        useDatabaseViewer({
          projectId: "00000000-0000-0000-0000-000000000001",
          isConnected,
          isStreaming: false,
          sendToPreview,
        }),
      { initialProps: { isConnected: false } }
    );

    expect(result.current.viewerMode).toBe("BOOTING");
    expect(result.current.introspectError).toBeNull();

    // PREVIEW_READY sets isConnected = true while PGlite inside the inner iframe is still booting
    rerender({ isConnected: true });

    await act(async () => {
      vi.advanceTimersByTime(13_000);
    });

    // Should not send premature DB_INTROSPECT_REQUEST or show timeout error before DB_READY_EVENT
    expect(sendToPreview).not.toHaveBeenCalledWith("DB_INTROSPECT_REQUEST", expect.anything());
    expect(result.current.introspectError).toBeNull();
    expect(result.current.viewerMode).toBe("BOOTING");

    // Once DB_READY_EVENT arrives, viewer transitions and introspects cleanly
    await act(async () => {
      result.current.handleBridgeMessage({
        protocol: "sparkweb:bridge:v1",
        type: "DB_READY_EVENT",
        source: "sparkweb:sandbox",
        payload: { tableCount: 1 },
        timestamp: Date.now(),
      });
    });

    expect(sendToPreview).toHaveBeenCalledWith(
      "DB_INTROSPECT_REQUEST",
      expect.objectContaining({ id: expect.any(String) })
    );
    expect(result.current.isDbReady).toBe(true);

    const introspectCall = sendToPreview.mock.calls.find(
      ([type]) => type === "DB_INTROSPECT_REQUEST"
    );
    const requestId = (introspectCall?.[1] as { id?: string } | undefined)?.id;

    await act(async () => {
      result.current.handleBridgeMessage({
        protocol: "sparkweb:bridge:v1",
        type: "DB_INTROSPECT_RESPONSE",
        source: "sparkweb:sandbox",
        payload: {
          id: requestId,
          tables: [
            {
              name: "demo_items",
              isReadOnly: false,
              rowCount: 0,
              columns: [],
            },
          ],
        },
        timestamp: Date.now(),
      });
    });

    expect(result.current.viewerMode).toBe("READY");
    expect(result.current.tables).toHaveLength(1);
    expect(result.current.introspectError).toBeNull();
  });

  it("falls back to remaining table without querying a dropped active table on refreshActiveView", async () => {
    const sendToPreview = vi.fn();
    const { result, rerender } = renderHook(
      ({ isConnected }) =>
        useDatabaseViewer({
          projectId: "00000000-0000-0000-0000-000000000001",
          isConnected,
          isStreaming: false,
          sendToPreview,
        }),
      { initialProps: { isConnected: true } }
    );

    // Boot with two tables and select the second one (keyless_log)
    await act(async () => {
      result.current.handleBridgeMessage({
        protocol: "sparkweb:bridge:v1",
        type: "DB_READY_EVENT",
        source: "sparkweb:sandbox",
        payload: { tableCount: 2 },
        timestamp: Date.now(),
      });
    });

    const firstIntrospectCall = sendToPreview.mock.calls.find(
      ([t]) => t === "DB_INTROSPECT_REQUEST"
    );
    const firstIntrospectId = (firstIntrospectCall?.[1] as { id?: string } | undefined)?.id ?? "";

    await act(async () => {
      result.current.handleBridgeMessage({
        protocol: "sparkweb:bridge:v1",
        type: "DB_INTROSPECT_RESPONSE",
        source: "sparkweb:sandbox",
        payload: {
          id: firstIntrospectId,
          tables: [
            { name: "demo_items", isReadOnly: false, rowCount: 1, columns: [] },
            { name: "keyless_log", isReadOnly: true, rowCount: 1, columns: [] },
          ],
        },
        timestamp: Date.now(),
      });
    });

    await act(async () => {
      result.current.handleSelectTable("keyless_log");
    });
    rerender({ isConnected: true });

    sendToPreview.mockClear();

    // Now simulate DB_MUTATED_EVENT after dropping keyless_log
    await act(async () => {
      result.current.handleBridgeMessage({
        protocol: "sparkweb:bridge:v1",
        type: "DB_MUTATED_EVENT",
        source: "sparkweb:sandbox",
        payload: { origin: "viewer", table: "keyless_log" },
        timestamp: Date.now(),
      });
    });

    const secondIntrospectCall = sendToPreview.mock.calls.find(
      ([t]) => t === "DB_INTROSPECT_REQUEST"
    );
    const secondIntrospectId = (secondIntrospectCall?.[1] as { id?: string } | undefined)?.id ?? "";

    await act(async () => {
      result.current.handleBridgeMessage({
        protocol: "sparkweb:bridge:v1",
        type: "DB_INTROSPECT_RESPONSE",
        source: "sparkweb:sandbox",
        payload: {
          id: secondIntrospectId,
          tables: [{ name: "demo_items", isReadOnly: false, rowCount: 1, columns: [] }],
        },
        timestamp: Date.now(),
      });
    });

    const queryCalls = sendToPreview.mock.calls
      .filter(([t]) => t === "DB_QUERY_REQUEST")
      .map(([, p]) => (p as { table?: string }).table);
    expect(queryCalls).not.toContain("keyless_log");
    expect(queryCalls).toContain("demo_items");
    expect(result.current.rowsError).toBeNull();
  });

  // covers: AC-9
  it("transitions to EMPTY when introspected schema has zero tables, and STREAMING_LOCKED when streaming", async () => {
    const sendToPreview = vi.fn();
    const { result, rerender } = renderHook(
      ({ isStreaming }) =>
        useDatabaseViewer({
          projectId: "00000000-0000-0000-0000-000000000001",
          isConnected: true,
          isStreaming,
          sendToPreview,
        }),
      { initialProps: { isStreaming: false } }
    );

    await act(async () => {
      result.current.handleBridgeMessage({
        protocol: "sparkweb:bridge:v1",
        type: "DB_READY_EVENT",
        source: "sparkweb:sandbox",
        payload: { tableCount: 0 },
        timestamp: Date.now(),
      });
    });

    const introCall = sendToPreview.mock.calls.find(([t]) => t === "DB_INTROSPECT_REQUEST");
    const introId = (introCall?.[1] as { id?: string } | undefined)?.id ?? "";

    await act(async () => {
      result.current.handleBridgeMessage({
        protocol: "sparkweb:bridge:v1",
        type: "DB_INTROSPECT_RESPONSE",
        source: "sparkweb:sandbox",
        payload: { id: introId, tables: [] },
        timestamp: Date.now(),
      });
    });

    expect(result.current.viewerMode).toBe("EMPTY");
    expect(result.current.tables).toEqual([]);

    rerender({ isStreaming: true });
    expect(result.current.viewerMode).toBe("STREAMING_LOCKED");

    // Visual mutations are blocked immediately while streaming
    const blocked = await result.current.executeMutation({
      action: "insert",
      table: "demo_items",
      record: { name: "Blocked" },
    });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain("locked");

    // Raw SQL forwards readOnly: true during streaming
    const rawPromise = result.current.executeRawSql("SELECT 1;");
    const queryCall = sendToPreview.mock.calls.find(([t]) => t === "DB_QUERY_REQUEST");
    expect(queryCall?.[1]).toEqual(
      expect.objectContaining({ rawSql: "SELECT 1;", readOnly: true })
    );
    const rawId = (queryCall?.[1] as { id?: string } | undefined)?.id ?? "";

    await act(async () => {
      result.current.handleBridgeMessage({
        protocol: "sparkweb:bridge:v1",
        type: "DB_QUERY_RESPONSE",
        source: "sparkweb:sandbox",
        payload: { id: rawId, rows: [{ "?column?": 1 }], totalCount: 1, executionTimeMs: 2 },
        timestamp: Date.now(),
      });
    });
    await expect(rawPromise).resolves.toMatchObject({ totalCount: 1 });
  });

  // covers: AC-3, AC-4
  it("resets page on sort/search changes and rejects RPC on 12s timeout or disconnect", async () => {
    const sendToPreview = vi.fn();
    const { result, rerender } = renderHook(
      ({ isConnected }) =>
        useDatabaseViewer({
          projectId: "00000000-0000-0000-0000-000000000001",
          isConnected,
          isStreaming: false,
          sendToPreview,
        }),
      { initialProps: { isConnected: true } }
    );

    // Trigger refreshSchema and let 12s client RPC timeout expire
    let schemaPromise: Promise<unknown> | undefined;
    act(() => {
      schemaPromise = result.current.refreshSchema();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    await schemaPromise;
    expect(result.current.introspectError).toContain("timed out");

    // Cycle sort direction: asc -> desc -> cleared
    act(() => {
      result.current.setPage(3);
      result.current.handleSortChange("name");
    });
    expect(result.current.sortColumn).toBe("name");
    expect(result.current.sortDirection).toBe("asc");
    expect(result.current.page).toBe(1);

    act(() => {
      result.current.handleSortChange("name");
    });
    expect(result.current.sortDirection).toBe("desc");

    act(() => {
      result.current.handleSortChange("name");
    });
    expect(result.current.sortColumn).toBeUndefined();

    act(() => {
      result.current.setPage(2);
      result.current.handleSearchChange("alice");
    });
    expect(result.current.searchQuery).toBe("alice");
    expect(result.current.page).toBe(1);

    // Disconnect resets readiness back to BOOTING
    rerender({ isConnected: false });
    expect(result.current.isDbReady).toBe(false);
    expect(result.current.viewerMode).toBe("BOOTING");
  });

  // covers: AC-2, AC-7, AC-8
  it("manages saved query snippet CRUD and exports seed.sql snapshot via API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/queries") && (!init || init.method === undefined)) {
        return { ok: true, json: async () => ({ queries: [] }) } as Response;
      }
      if (url.endsWith("/queries") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            query: {
              id: "q-new",
              projectId: "00000000-0000-0000-0000-000000000001",
              title: "List items",
              sql: "SELECT * FROM items;",
              description: null,
              isFavorite: true,
              createdAt: "2026-11-25T10:00:00.000Z",
              updatedAt: "2026-11-25T10:00:00.000Z",
            },
          }),
        } as Response;
      }
      if (url.endsWith("/queries/q-new") && init?.method === "PATCH") {
        return {
          ok: true,
          json: async () => ({
            query: {
              id: "q-new",
              projectId: "00000000-0000-0000-0000-000000000001",
              title: "List items",
              sql: "SELECT * FROM items;",
              description: null,
              isFavorite: false,
              createdAt: "2026-11-25T10:00:00.000Z",
              updatedAt: "2026-11-25T10:05:00.000Z",
            },
          }),
        } as Response;
      }
      if (url.endsWith("/queries/q-new") && init?.method === "DELETE") {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      if (url.endsWith("/database/seed") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            snapshotId: "snap-seed-99",
            treeHash: "hash-99",
            tag: "database_seed",
            createdAt: "2026-11-25T10:10:00.000Z",
          }),
        } as Response;
      }
      return { ok: false, json: async () => ({ error: "Unexpected call" }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const sendToPreview = vi.fn();
    const onSeedSnapshotSaved = vi.fn();
    const { result } = renderHook(() =>
      useDatabaseViewer({
        projectId: "00000000-0000-0000-0000-000000000001",
        isConnected: true,
        isStreaming: false,
        sendToPreview,
        onSeedSnapshotSaved,
      })
    );

    await act(async () => {
      await result.current.saveQuerySnippet({
        title: "List items",
        sql: "SELECT * FROM items;",
        isFavorite: true,
      });
    });
    expect(result.current.savedQueries).toHaveLength(1);

    await act(async () => {
      await result.current.updateQuerySnippet("q-new", { isFavorite: false });
    });
    expect(result.current.savedQueries[0]?.isFavorite).toBe(false);

    await act(async () => {
      await result.current.deleteQuerySnippet("q-new");
    });
    expect(result.current.savedQueries).toHaveLength(0);

    // Export seed data and commit snapshot
    let exportPromise: Promise<void> | undefined;
    act(() => {
      exportPromise = result.current.exportAndSaveSeed();
    });

    const seedReq = sendToPreview.mock.calls.find(([t]) => t === "DB_EXPORT_SEED_REQUEST");
    const seedReqId = (seedReq?.[1] as { id?: string } | undefined)?.id ?? "";
    const exportedSql = 'INSERT INTO "items" ("id") VALUES (1);';

    await act(async () => {
      result.current.handleBridgeMessage({
        protocol: "sparkweb:bridge:v1",
        type: "DB_EXPORT_SEED_RESPONSE",
        source: "sparkweb:sandbox",
        payload: { id: seedReqId, sql: exportedSql, tableCount: 1, rowCount: 1 },
        timestamp: Date.now(),
      });
      await exportPromise;
    });

    expect(onSeedSnapshotSaved).toHaveBeenCalledWith("snap-seed-99", exportedSql);
    expect(result.current.seedFeedback).toEqual({
      type: "success",
      message: "Saved 1 rows across 1 tables to seed.sql",
    });
  });
});

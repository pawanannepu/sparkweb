"use client";

import type {
  BridgeMessage,
  BridgeMessageType,
  DatabaseViewerMode,
  DbExportSeedResponsePayload,
  DbIntrospectResponsePayload,
  DbMutateAction,
  DbMutateResponsePayload,
  DbQueryResponsePayload,
  DbTableMetadata,
  ProjectQuerySummary,
} from "@spark/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UseDatabaseViewerOptions {
  projectId: string;
  isConnected: boolean;
  isStreaming: boolean;
  sendToPreview: (type: BridgeMessageType, payload?: Record<string, unknown>) => void;
  onSeedSnapshotSaved?: (snapshotId: string, sql: string) => void;
}

interface PendingRpc {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CLIENT_RPC_TIMEOUT_MS = 12_000;

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function useDatabaseViewer({
  projectId,
  isConnected,
  isStreaming,
  sendToPreview,
  onSeedSnapshotSaved,
}: UseDatabaseViewerOptions) {
  const [isDbReady, setIsDbReady] = useState(false);
  const [tables, setTables] = useState<DbTableMetadata[]>([]);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null);
  const [isIntrospecting, setIsIntrospecting] = useState(false);
  const [introspectError, setIntrospectError] = useState<string | null>(null);

  // Table browser pagination / sort / search state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortColumn, setSortColumn] = useState<string | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [lastExecutionTimeMs, setLastExecutionTimeMs] = useState<number | null>(null);

  // Saved query snippets state
  const [savedQueries, setSavedQueries] = useState<ProjectQuerySummary[]>([]);
  const [isLoadingQueries, setIsLoadingQueries] = useState(false);
  const [queriesError, setQueriesError] = useState<string | null>(null);

  // Seed export state
  const [isExportingSeed, setIsExportingSeed] = useState(false);
  const [seedFeedback, setSeedFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const pendingRpcRef = useRef<Map<string, PendingRpc>>(new Map());
  const selectedTableRef = useRef<string | null>(selectedTableName);
  selectedTableRef.current = selectedTableName;

  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  // Reject any pending RPCs on unmount
  useEffect(() => {
    const rpcMap = pendingRpcRef.current;
    return () => {
      for (const pending of rpcMap.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Database viewer unmounted"));
      }
      rpcMap.clear();
    };
  }, []);

  const callBridgeRpc = useCallback(
    <T>(
      type: BridgeMessageType,
      payload: Record<string, unknown>,
      timeoutMs = CLIENT_RPC_TIMEOUT_MS
    ): Promise<T> => {
      const id = createRequestId();
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRpcRef.current.delete(id);
          reject(new Error("Database request timed out waiting for sandbox response"));
        }, timeoutMs);

        pendingRpcRef.current.set(id, {
          resolve: (res) => resolve(res as T),
          reject,
          timer,
        });

        sendToPreview(type, { ...payload, id });
      });
    },
    [sendToPreview]
  );

  const fetchTableRows = useCallback(
    async (
      tableName: string,
      opts?: {
        page?: number;
        pageSize?: number;
        sortColumn?: string;
        sortDirection?: "asc" | "desc";
        search?: string;
      }
    ) => {
      const targetPage = opts?.page ?? page;
      const targetPageSize = opts?.pageSize ?? pageSize;
      const targetSortCol = opts && "sortColumn" in opts ? opts.sortColumn : sortColumn;
      const targetSortDir = opts?.sortDirection ?? sortDirection;
      const targetSearch = opts && "search" in opts ? opts.search : searchQuery;

      setIsLoadingRows(true);
      setRowsError(null);
      try {
        const res = await callBridgeRpc<DbQueryResponsePayload>("DB_QUERY_REQUEST", {
          table: tableName,
          page: targetPage,
          pageSize: targetPageSize,
          sortColumn: targetSortCol,
          sortDirection: targetSortDir,
          search: targetSearch,
        });
        if (res.error) {
          setRowsError(res.error);
          setRows([]);
          setTotalCount(0);
        } else {
          setRows(res.rows);
          setTotalCount(res.totalCount);
          setLastExecutionTimeMs(res.executionTimeMs);
        }
      } catch (err: unknown) {
        setRowsError(err instanceof Error ? err.message : "Failed to load table rows");
      } finally {
        setIsLoadingRows(false);
      }
    },
    [callBridgeRpc, page, pageSize, sortColumn, sortDirection, searchQuery]
  );

  const refreshSchema = useCallback(
    async (options?: { preserveSelection?: boolean }) => {
      setIsIntrospecting(true);
      setIntrospectError(null);
      try {
        const res = await callBridgeRpc<DbIntrospectResponsePayload>("DB_INTROSPECT_REQUEST", {});
        if (res.error) {
          setIntrospectError(res.error);
          return [];
        }
        setIsDbReady(true);
        setTables(res.tables);

        const currentSelected = selectedTableRef.current;
        const stillExists = currentSelected && res.tables.some((t) => t.name === currentSelected);

        if (options?.preserveSelection && stillExists) {
          return res.tables;
        }

        if (!stillExists) {
          const first = res.tables[0]?.name ?? null;
          selectedTableRef.current = first;
          setSelectedTableName(first);
          setPage(1);
          setSortColumn(undefined);
          setSearchQuery("");
        }
        return res.tables;
      } catch (err: unknown) {
        setIntrospectError(err instanceof Error ? err.message : "Failed to introspect database");
        return [];
      } finally {
        setIsIntrospecting(false);
      }
    },
    [callBridgeRpc]
  );

  const refreshActiveView = useCallback(async () => {
    const updatedTables = await refreshSchema({ preserveSelection: true });
    const target = updatedTables.some((t) => t.name === selectedTableRef.current)
      ? selectedTableRef.current
      : (updatedTables[0]?.name ?? null);
    if (target) {
      await fetchTableRows(target);
    } else {
      setRows([]);
      setTotalCount(0);
    }
  }, [fetchTableRows, refreshSchema]);

  // Reset database readiness when preview disconnects; wait for DB_READY_EVENT on boot
  useEffect(() => {
    if (!isConnected) {
      setIsDbReady(false);
      setIntrospectError(null);
      setRowsError(null);
      for (const pending of pendingRpcRef.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Preview sandbox disconnected"));
      }
      pendingRpcRef.current.clear();
    }
  }, [isConnected]);

  // Fetch rows whenever active table or pagination/sort/search changes while ready
  useEffect(() => {
    if (!isDbReady || !selectedTableName) {
      if (!selectedTableName) {
        setRows([]);
        setTotalCount(0);
      }
      return;
    }
    fetchTableRows(selectedTableName).catch(() => {
      // Handled inside fetchTableRows
    });
  }, [isDbReady, selectedTableName, fetchTableRows]);

  const handleSelectTable = useCallback((tableName: string) => {
    setSelectedTableName(tableName);
    setPage(1);
    setSortColumn(undefined);
    setSortDirection("asc");
    setSearchQuery("");
  }, []);

  const handleSortChange = useCallback(
    (columnName: string) => {
      if (sortColumn === columnName) {
        if (sortDirection === "asc") {
          setSortDirection("desc");
        } else {
          setSortColumn(undefined);
          setSortDirection("asc");
        }
      } else {
        setSortColumn(columnName);
        setSortDirection("asc");
      }
      setPage(1);
    },
    [sortColumn, sortDirection]
  );

  const handleSearchChange = useCallback((term: string) => {
    setSearchQuery(term);
    setPage(1);
  }, []);

  const handleBridgeMessage = useCallback(
    (msg: BridgeMessage) => {
      if (msg.type === "DB_READY_EVENT") {
        setIsDbReady(true);
        refreshActiveView().catch(() => {});
        return;
      }

      if (msg.type === "DB_MUTATED_EVENT") {
        refreshActiveView().catch(() => {});
        return;
      }

      if (
        msg.type === "DB_INTROSPECT_RESPONSE" ||
        msg.type === "DB_QUERY_RESPONSE" ||
        msg.type === "DB_MUTATE_RESPONSE" ||
        msg.type === "DB_EXPORT_SEED_RESPONSE"
      ) {
        const payload = msg.payload as { id?: string };
        const id = payload?.id;
        if (id && pendingRpcRef.current.has(id)) {
          const pending = pendingRpcRef.current.get(id);
          if (pending) {
            clearTimeout(pending.timer);
            pendingRpcRef.current.delete(id);
            pending.resolve(msg.payload);
          }
        }
      }
    },
    [refreshActiveView]
  );

  const executeMutation = useCallback(
    async (params: {
      action: DbMutateAction;
      table: string;
      record?: Record<string, unknown>;
      where?: Record<string, unknown>;
    }): Promise<DbMutateResponsePayload> => {
      if (isStreamingRef.current) {
        return {
          id: "blocked",
          success: false,
          affectedRows: 0,
          error: "Mutations are locked while AI generation is streaming",
        };
      }
      const res = await callBridgeRpc<DbMutateResponsePayload>("DB_MUTATE_REQUEST", {
        ...params,
        readOnly: isStreamingRef.current,
      });
      if (res.success) {
        await refreshActiveView();
      }
      return res;
    },
    [callBridgeRpc, refreshActiveView]
  );

  const executeRawSql = useCallback(
    async (rawSql: string): Promise<DbQueryResponsePayload> => {
      const res = await callBridgeRpc<DbQueryResponsePayload>("DB_QUERY_REQUEST", {
        rawSql,
        readOnly: isStreamingRef.current,
      });
      return res;
    },
    [callBridgeRpc]
  );

  const fetchSavedQueries = useCallback(
    async (favoriteOnly?: boolean) => {
      setIsLoadingQueries(true);
      setQueriesError(null);
      try {
        const qs = favoriteOnly !== undefined ? `?favorite=${String(favoriteOnly)}` : "";
        const res = await fetch(`/api/projects/${projectId}/queries${qs}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to load saved queries");
        }
        setSavedQueries(data.queries ?? []);
      } catch (err: unknown) {
        setQueriesError(err instanceof Error ? err.message : "Failed to load saved queries");
      } finally {
        setIsLoadingQueries(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    fetchSavedQueries().catch(() => {});
  }, [fetchSavedQueries]);

  const saveQuerySnippet = useCallback(
    async (input: {
      title: string;
      sql: string;
      description?: string;
      isFavorite?: boolean;
    }): Promise<ProjectQuerySummary | null> => {
      const res = await fetch(`/api/projects/${projectId}/queries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save query snippet");
      }
      const created = data.query as ProjectQuerySummary;
      setSavedQueries((prev) => [created, ...prev]);
      return created;
    },
    [projectId]
  );

  const updateQuerySnippet = useCallback(
    async (
      queryId: string,
      patch: { title?: string; sql?: string; description?: string | null; isFavorite?: boolean }
    ): Promise<ProjectQuerySummary | null> => {
      const res = await fetch(`/api/projects/${projectId}/queries/${queryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update query snippet");
      }
      const updated = data.query as ProjectQuerySummary;
      setSavedQueries((prev) => prev.map((q) => (q.id === queryId ? updated : q)));
      return updated;
    },
    [projectId]
  );

  const deleteQuerySnippet = useCallback(
    async (queryId: string): Promise<void> => {
      const res = await fetch(`/api/projects/${projectId}/queries/${queryId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete query snippet");
      }
      setSavedQueries((prev) => prev.filter((q) => q.id !== queryId));
    },
    [projectId]
  );

  const exportAndSaveSeed = useCallback(async () => {
    if (isStreamingRef.current) {
      setSeedFeedback({
        type: "error",
        message: "Wait for active generation to finish before saving seed snapshot",
      });
      return;
    }

    setIsExportingSeed(true);
    setSeedFeedback(null);
    try {
      const exported = await callBridgeRpc<DbExportSeedResponsePayload>(
        "DB_EXPORT_SEED_REQUEST",
        {}
      );
      if (exported.error) {
        throw new Error(exported.error);
      }

      const res = await fetch(`/api/projects/${projectId}/database/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: exported.sql }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to commit seed.sql snapshot");
      }

      onSeedSnapshotSaved?.(data.snapshotId, exported.sql);
      setSeedFeedback({
        type: "success",
        message: `Saved ${exported.rowCount} rows across ${exported.tableCount} tables to seed.sql`,
      });
    } catch (err: unknown) {
      setSeedFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to export seed data",
      });
    } finally {
      setIsExportingSeed(false);
    }
  }, [callBridgeRpc, onSeedSnapshotSaved, projectId]);

  const selectedTable = useMemo(
    () => tables.find((t) => t.name === selectedTableName) ?? null,
    [tables, selectedTableName]
  );

  const viewerMode: DatabaseViewerMode = useMemo(() => {
    if (!isDbReady) return "BOOTING";
    if (isStreaming) return "STREAMING_LOCKED";
    if (tables.length === 0) return "EMPTY";
    return "READY";
  }, [isDbReady, isStreaming, tables.length]);

  return {
    viewerMode,
    isDbReady,
    tables,
    selectedTable,
    selectedTableName,
    isIntrospecting,
    introspectError,
    page,
    setPage,
    pageSize,
    setPageSize,
    sortColumn,
    sortDirection,
    searchQuery,
    rows,
    totalCount,
    isLoadingRows,
    rowsError,
    lastExecutionTimeMs,
    savedQueries,
    isLoadingQueries,
    queriesError,
    isExportingSeed,
    seedFeedback,
    setSeedFeedback,
    handleBridgeMessage,
    handleSelectTable,
    handleSortChange,
    handleSearchChange,
    refreshSchema,
    refreshActiveView,
    executeMutation,
    executeRawSql,
    fetchSavedQueries,
    saveQuerySnippet,
    updateQuerySnippet,
    deleteQuerySnippet,
    exportAndSaveSeed,
  };
}

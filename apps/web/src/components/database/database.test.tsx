import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { DbTableMetadata, ProjectQuerySummary } from "@spark/shared";
import { DatabaseViewer } from "./DatabaseViewer";

const SAMPLE_TABLES: DbTableMetadata[] = [
  {
    name: "users",
    isReadOnly: false,
    rowCount: 2,
    columns: [
      {
        name: "id",
        type: "integer",
        nullable: false,
        isPrimaryKey: true,
        isIdentity: true,
        defaultValue: "nextval('users_id_seq'::regclass)",
      },
      {
        name: "email",
        type: "text",
        nullable: false,
        isPrimaryKey: false,
        isIdentity: false,
        defaultValue: null,
      },
    ],
  },
  {
    name: "events_log",
    isReadOnly: true,
    rowCount: 1,
    columns: [
      {
        name: "event",
        type: "text",
        nullable: false,
        isPrimaryKey: false,
        isIdentity: false,
        defaultValue: null,
      },
    ],
  },
];

const SAMPLE_QUERIES: ProjectQuerySummary[] = [
  {
    id: "q-1",
    projectId: "p-1",
    title: "All users",
    sql: "SELECT * FROM users;",
    description: "Fetch every user",
    isFavorite: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function makeProps(overrides: Partial<React.ComponentProps<typeof DatabaseViewer>> = {}) {
  return {
    viewerMode: "READY" as const,
    tables: SAMPLE_TABLES,
    selectedTable: SAMPLE_TABLES[0] ?? null,
    selectedTableName: "users",
    isIntrospecting: false,
    introspectError: null,
    rows: [
      { id: 1, email: "alice@example.com" },
      { id: 2, email: "bob@example.com" },
    ],
    totalCount: 2,
    page: 1,
    pageSize: 25,
    sortDirection: "asc" as const,
    searchQuery: "",
    isLoadingRows: false,
    rowsError: null,
    savedQueries: SAMPLE_QUERIES,
    isLoadingQueries: false,
    isExportingSeed: false,
    seedFeedback: null,
    onDismissSeedFeedback: vi.fn(),
    onSelectTable: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    onSortChange: vi.fn(),
    onSearchChange: vi.fn(),
    onRefreshAll: vi.fn(),
    onExecuteMutation: vi.fn().mockResolvedValue({ id: "1", success: true, affectedRows: 1 }),
    onExecuteRawSql: vi.fn().mockResolvedValue({
      id: "1",
      rows: [{ id: 1 }],
      totalCount: 1,
      executionTimeMs: 4,
      columns: ["id"],
    }),
    onSaveSnippet: vi.fn().mockResolvedValue(SAMPLE_QUERIES[0] ?? null),
    onUpdateSnippet: vi.fn().mockResolvedValue(SAMPLE_QUERIES[0] ?? null),
    onDeleteSnippet: vi.fn().mockResolvedValue(undefined),
    onSaveSeedData: vi.fn().mockResolvedValue(undefined),
    onAskSparkSchema: vi.fn(),
    ...overrides,
  };
}

describe("DatabaseViewer Component", () => {
  it("renders booting skeleton before PGlite signals ready (AC-9)", () => {
    render(<DatabaseViewer {...makeProps({ viewerMode: "BOOTING", tables: [] })} />);
    expect(
      screen.getByRole("status", { name: "Initializing PGlite database" })
    ).toBeInTheDocument();
  });

  it("renders guided empty state with schema prompt chips when 0 tables exist (AC-9)", () => {
    const onAskSparkSchema = vi.fn();
    render(
      <DatabaseViewer
        {...makeProps({
          viewerMode: "EMPTY",
          tables: [],
          selectedTable: null,
          selectedTableName: null,
          onAskSparkSchema,
        })}
      />
    );

    expect(screen.getByText("No tables created yet")).toBeInTheDocument();
    const chip = screen.getByRole("button", {
      name: /Add a users table with id, email, name/i,
    });
    fireEvent.click(chip);
    expect(onAskSparkSchema).toHaveBeenCalledTimes(1);
  });

  it("renders table sidebar, data grid rows, Add Record sheet, and Delete modal (AC-4, AC-5)", () => {
    render(<DatabaseViewer {...makeProps()} />);

    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();

    // Open Add Record sheet
    fireEvent.click(screen.getByRole("button", { name: /Add Record/i }));
    expect(screen.getByText("Add Record to users")).toBeInTheDocument();

    // Close sheet and open Delete confirmation dialog
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    const deleteButtons = screen.getAllByRole("button", { name: "Delete row" });
    const firstDelete = deleteButtons[0];
    if (!firstDelete) throw new Error("Delete button not found");
    fireEvent.click(firstDelete);
    expect(screen.getByText(/This permanently deletes the selected record/i)).toBeInTheDocument();
  });

  it("enforces read only lock banner and disables mutations during streaming (AC-9)", () => {
    render(<DatabaseViewer {...makeProps({ viewerMode: "STREAMING_LOCKED" })} />);

    expect(screen.getByText(/Read Only Lock Active:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Record/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save As Seed Data/i })).toBeDisabled();
  });

  it("keeps inline cell input mounted and focused across multi-character typing (AC-5)", async () => {
    const user = userEvent.setup();
    const onExecuteMutation = vi
      .fn()
      .mockResolvedValue({ id: "1", success: true, affectedRows: 1 });
    render(<DatabaseViewer {...makeProps({ onExecuteMutation })} />);

    await user.click(screen.getByText("alice@example.com"));

    const input = screen.getByLabelText("Edit email");
    expect(input).toHaveFocus();

    await user.clear(input);
    await user.type(input, "updated@example.com");

    expect(screen.getByLabelText("Edit email")).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("updated@example.com");

    await user.click(screen.getByRole("button", { name: "Save cell edit" }));

    await waitFor(() => {
      expect(onExecuteMutation).toHaveBeenCalledWith({
        action: "update",
        table: "users",
        where: { id: 1 },
        record: { email: "updated@example.com" },
      });
    });
  });

  it("shows validation error when clearing a NOT NULL text cell inline (AC-5)", async () => {
    const user = userEvent.setup();
    const onExecuteMutation = vi.fn();
    render(<DatabaseViewer {...makeProps({ onExecuteMutation })} />);

    await user.click(screen.getByText("alice@example.com"));
    const input = screen.getByLabelText("Edit email");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Save cell edit" }));

    expect(screen.getByRole("alert")).toHaveTextContent("email cannot be empty");
    expect(onExecuteMutation).not.toHaveBeenCalled();
  });

  it("disables Add Record and Delete row on read-only keyless tables (AC-5)", () => {
    const readOnlyTable = SAMPLE_TABLES[1];
    if (!readOnlyTable) throw new Error("Missing read-only fixture");

    render(
      <DatabaseViewer
        {...makeProps({
          selectedTable: readOnlyTable,
          selectedTableName: readOnlyTable.name,
          rows: [{ event: "app_boot" }],
          totalCount: 1,
        })}
      />
    );

    expect(screen.getByText("Read Only (No PK)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Record/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete row" })).toBeDisabled();

    // Empty keyless table should also hide Add First Record
    render(
      <DatabaseViewer
        {...makeProps({
          selectedTable: readOnlyTable,
          selectedTableName: readOnlyTable.name,
          rows: [],
          totalCount: 0,
        })}
      />
    );
    expect(screen.queryByRole("button", { name: /Add First Record/i })).not.toBeInTheDocument();
  });

  // covers: AC-5
  it("submits Add Record sheet respecting identity columns and explicit NULL checkboxes", async () => {
    const user = userEvent.setup();
    const tableWithNullable: DbTableMetadata = {
      name: "tasks",
      isReadOnly: false,
      rowCount: 0,
      columns: [
        {
          name: "id",
          type: "integer",
          nullable: false,
          isPrimaryKey: true,
          isIdentity: true,
          defaultValue: "nextval('tasks_id_seq'::regclass)",
        },
        {
          name: "title",
          type: "text",
          nullable: false,
          isPrimaryKey: false,
          isIdentity: false,
          defaultValue: null,
        },
        {
          name: "notes",
          type: "text",
          nullable: true,
          isPrimaryKey: false,
          isIdentity: false,
          defaultValue: null,
        },
      ],
    };

    const onExecuteMutation = vi
      .fn()
      .mockResolvedValue({ id: "1", success: true, affectedRows: 1 });

    render(
      <DatabaseViewer
        {...makeProps({
          tables: [tableWithNullable],
          selectedTable: tableWithNullable,
          selectedTableName: "tasks",
          rows: [],
          totalCount: 0,
          onExecuteMutation,
        })}
      />
    );

    await user.click(screen.getByRole("button", { name: /Add First Record/i }));

    // Submitting without required title shows field validation error
    await user.click(screen.getByRole("button", { name: /Insert Record/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("This field is required");
    expect(onExecuteMutation).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/title/i), "Ship database tests");
    await user.click(screen.getByRole("checkbox", { name: /NULL/i }));
    await user.click(screen.getByRole("button", { name: /Insert Record/i }));

    await waitFor(() => {
      expect(onExecuteMutation).toHaveBeenCalledWith({
        action: "insert",
        table: "tasks",
        record: {
          title: "Ship database tests",
          notes: null,
        },
      });
    });
  });

  // covers: AC-5
  it("confirms row deletion via Delete Row modal and handles mutation errors", async () => {
    const user = userEvent.setup();
    const onExecuteMutation = vi
      .fn()
      .mockResolvedValueOnce({ id: "1", success: false, affectedRows: 0, error: "FK violation" })
      .mockResolvedValueOnce({ id: "2", success: true, affectedRows: 1 });

    render(<DatabaseViewer {...makeProps({ onExecuteMutation })} />);

    const deleteButtons = screen.getAllByRole("button", { name: "Delete row" });
    const firstDeleteBtn = deleteButtons[0];
    if (!firstDeleteBtn) throw new Error("Delete button not found");
    await user.click(firstDeleteBtn);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("id:");
    expect(dialog).toHaveTextContent("1");

    const confirmBtn = screen.getAllByRole("button", { name: "Delete Row" }).at(-1);
    if (!confirmBtn) throw new Error("Confirm delete button not found");
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(onExecuteMutation).toHaveBeenCalledWith({
        action: "delete",
        table: "users",
        where: { id: 1 },
      });
    });
    expect(
      screen.getAllByRole("alert").some((el) => el.textContent?.includes("FK violation"))
    ).toBe(true);
  });

  // covers: AC-4
  it("supports table sidebar filtering, sorting, search debounce, and pagination controls", async () => {
    const user = userEvent.setup();
    const manyTables: DbTableMetadata[] = [
      ...SAMPLE_TABLES,
      { name: "orders", isReadOnly: false, rowCount: 10, columns: [] },
      { name: "invoices", isReadOnly: false, rowCount: 4, columns: [] },
      { name: "payments", isReadOnly: false, rowCount: 7, columns: [] },
      { name: "audit_archive", isReadOnly: true, rowCount: 99, columns: [] },
    ];
    const onSelectTable = vi.fn();
    const onSortChange = vi.fn();
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const onSearchChange = vi.fn();

    render(
      <DatabaseViewer
        {...makeProps({
          tables: manyTables,
          totalCount: 60,
          page: 1,
          pageSize: 25,
          onSelectTable,
          onSortChange,
          onPageChange,
          onPageSizeChange,
          onSearchChange,
        })}
      />
    );

    // Sidebar filter appears when >5 tables exist
    const tableFilter = screen.getByLabelText("Filter tables");
    await user.type(tableFilter, "orders");
    expect(screen.getByRole("button", { name: /orders/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invoices/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /orders/i }));
    expect(onSelectTable).toHaveBeenCalledWith("orders");

    // Column sorting
    await user.click(screen.getByRole("button", { name: /email/i }));
    expect(onSortChange).toHaveBeenCalledWith("email");

    // Pagination controls
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    await user.selectOptions(screen.getByLabelText("Rows per page"), "50");
    expect(onPageSizeChange).toHaveBeenCalledWith(50);

    // Search input updates after debounce
    const searchInput = screen.getByLabelText("Search table rows");
    await user.type(searchInput, "alice");
    await waitFor(() => {
      expect(onSearchChange).toHaveBeenCalledWith("alice");
    });
  });

  // covers: AC-7, AC-8, AC-9
  it("runs SQL Console queries, blocks destructive SQL with confirmation modal, and manages snippets", async () => {
    const user = userEvent.setup();
    const onExecuteRawSql = vi.fn().mockResolvedValue({
      id: "sql-1",
      rows: [{ id: 1, email: "alice@example.com" }],
      totalCount: 1,
      executionTimeMs: 7,
      columns: ["id", "email"],
    });
    const onSaveSnippet = vi.fn().mockResolvedValue(SAMPLE_QUERIES[0] ?? null);
    const onUpdateSnippet = vi.fn().mockResolvedValue(SAMPLE_QUERIES[0] ?? null);
    const onDeleteSnippet = vi.fn().mockResolvedValue(undefined);
    const onSaveSeedData = vi.fn().mockResolvedValue(undefined);
    const onAskSparkSchema = vi.fn();

    render(
      <DatabaseViewer
        {...makeProps({
          savedQueries: [
            ...SAMPLE_QUERIES,
            {
              id: "q-2",
              projectId: "p-1",
              title: "Dangerous cleanup",
              sql: "DELETE FROM users;",
              description: null,
              isFavorite: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          seedFeedback: { type: "success", message: "Saved 2 rows to seed.sql" },
          onExecuteRawSql,
          onSaveSnippet,
          onUpdateSnippet,
          onDeleteSnippet,
          onSaveSeedData,
          onAskSparkSchema,
        })}
      />
    );

    // Top bar schema prompt + seed export
    expect(screen.getByText("Saved 2 rows to seed.sql")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save As Seed Data/i }));
    expect(onSaveSeedData).toHaveBeenCalledTimes(1);

    await user.type(
      screen.getByLabelText("Ask spark to update database schema"),
      "Add a comments table"
    );
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(onAskSparkSchema).toHaveBeenCalledWith("Add a comments table");

    // Switch to SQL Console
    await user.click(screen.getByRole("button", { name: /SQL Console/i }));

    // Run default query
    await user.click(screen.getByRole("button", { name: /Run Query/i }));
    await waitFor(() => {
      expect(onExecuteRawSql).toHaveBeenCalledWith('SELECT * FROM "users" LIMIT 50;');
    });
    expect(screen.getByText("7 ms")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();

    // Save current SQL as snippet
    await user.click(screen.getByRole("button", { name: /Save Snippet/i }));
    await user.type(screen.getByLabelText("Title"), "Fetch users");
    await user.click(screen.getByRole("button", { name: "Save Snippet" }));
    await waitFor(() => {
      expect(onSaveSnippet).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Fetch users",
          sql: 'SELECT * FROM "users" LIMIT 50;',
        })
      );
    });

    // Filter pinned favorites and pin/delete snippet
    await user.click(screen.getByRole("button", { name: "Pinned" }));
    expect(screen.getByText("All users")).toBeInTheDocument();
    expect(screen.queryByText("Dangerous cleanup")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    // Click destructive snippet to load it into editor, then trigger destructive confirmation modal
    await user.click(screen.getByText("Dangerous cleanup"));
    await user.click(screen.getByRole("button", { name: /Run Query/i }));

    expect(screen.getByText("Confirm Destructive SQL Statement")).toBeInTheDocument();
    expect(onExecuteRawSql).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Execute Anyway" }));
    await waitFor(() => {
      expect(onExecuteRawSql).toHaveBeenCalledWith("DELETE FROM users;");
    });

    // Pin & delete snippet actions
    const pinBtn = screen.getByRole("button", { name: "Pin snippet as favorite" });
    await user.click(pinBtn);
    expect(onUpdateSnippet).toHaveBeenCalledWith("q-2", { isFavorite: true });

    const deleteSnippetBtns = screen.getAllByRole("button", { name: "Delete snippet" });
    const firstSnippetDelete = deleteSnippetBtns[0];
    if (!firstSnippetDelete) throw new Error("Delete snippet button missing");
    await user.click(firstSnippetDelete);
    expect(onDeleteSnippet).toHaveBeenCalledWith("q-1");
  });
});

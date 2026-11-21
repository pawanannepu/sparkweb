import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./index";

describe("Base UI Primitives", () => {
  it("renders Button with default and variant styles, supporting click events", async () => {
    const handleClick = vi.fn();
    render(
      <Button variant="secondary" size="sm" onClick={handleClick}>
        Test Button
      </Button>
    );

    const btn = screen.getByRole("button", { name: "Test Button" });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveClass("bg-secondary");

    await userEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("disables Button when isLoading or disabled is true", () => {
    render(<Button isLoading>Loading State</Button>);
    const btn = screen.getByRole("button", { name: /Loading State/i });
    expect(btn).toBeDisabled();
  });

  it("renders Input with focus ring and error states", () => {
    render(<Input placeholder="Type prompt" error aria-label="Prompt Input" />);
    const input = screen.getByRole("textbox", { name: "Prompt Input" });
    expect(input).toBeInTheDocument();
    expect(input).toHaveClass("border-destructive");
  });

  it("renders Textarea accepting user text input", async () => {
    render(<Textarea placeholder="Multi line input" aria-label="Text Area" />);
    const textarea = screen.getByRole("textbox", { name: "Text Area" });
    expect(textarea).toBeInTheDocument();

    await userEvent.type(textarea, "Hello Sparkweb");
    expect(textarea).toHaveValue("Hello Sparkweb");
  });

  it("renders Badge variants properly", () => {
    render(
      <>
        <Badge variant="outline">Outline Badge</Badge>
        <Badge variant="success">Success Badge</Badge>
      </>
    );
    expect(screen.getByText("Outline Badge")).toBeInTheDocument();
    expect(screen.getByText("Success Badge")).toHaveClass("bg-emerald-600");
  });

  it("renders Separator with horizontal and vertical orientations", () => {
    const { container } = render(
      <>
        <Separator orientation="horizontal" />
        <Separator orientation="vertical" />
      </>
    );
    const separators = container.querySelectorAll("[data-orientation]");
    expect(separators.length).toBe(2);
  });

  it("renders Tabs and switches content on trigger selection", async () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">First</TabsTrigger>
          <TabsTrigger value="tab2">Second</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">First Content</TabsContent>
        <TabsContent value="tab2">Second Content</TabsContent>
      </Tabs>
    );

    expect(screen.getByText("First Content")).toBeInTheDocument();
    expect(screen.queryByText("Second Content")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Second" }));
    expect(screen.getByText("Second Content")).toBeInTheDocument();
  });

  it("renders ScrollArea with viewport wrapper", () => {
    render(
      <ScrollArea className="h-32">
        <p>Scrollable long text</p>
      </ScrollArea>
    );
    expect(screen.getByText("Scrollable long text")).toBeInTheDocument();
  });

  it("renders Tooltip with trigger element", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button>Hover me</Button>
          </TooltipTrigger>
          <TooltipContent>Helpful info</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    expect(screen.getByRole("button", { name: "Hover me" })).toBeInTheDocument();
  });

  it("renders Dialog overlay and content on trigger click", async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open Modal</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modal Title</DialogTitle>
            <DialogDescription>Modal Description</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );

    expect(screen.queryByText("Modal Title")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Modal" }));
    expect(screen.getByText("Modal Title")).toBeInTheDocument();
    expect(screen.getByText("Modal Description")).toBeInTheDocument();
  });

  it("renders DropdownMenu and displays items on trigger click (AC-2)", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Options</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    expect(screen.queryByText("Duplicate")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Options" }));
    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });
});

"use client";

import { Cpu, Sparkles, Square } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";

export interface PromptComposerProps {
  onSubmit: (prompt: string, model: string) => void;
  onCancel?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  className?: string;
}

const AVAILABLE_MODELS = [
  { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", badge: "Default" },
  { id: "gpt-4o", name: "GPT-4o", badge: "OpenAI" },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", badge: "Google" },
];

export function PromptComposer({
  onSubmit,
  onCancel,
  isStreaming = false,
  disabled = false,
  className,
}: PromptComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState("claude-3-7-sonnet");

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!prompt.trim() || isStreaming || disabled) return;
    onSubmit(prompt.trim(), selectedModel);
    setPrompt("");
  };

  const activeModelObj = AVAILABLE_MODELS.find((m) => m.id === selectedModel) ||
    AVAILABLE_MODELS[0] || {
      id: "claude-3-7-sonnet",
      name: "Claude 3.7 Sonnet",
      badge: "Default",
    };

  return (
    <div
      className={`relative flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm ${className || ""}`}
    >
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isStreaming
            ? "Generation in progress..."
            : "Describe the application or component you want to build..."
        }
        disabled={isStreaming || disabled}
        rows={3}
        className="min-h-[80px] resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
      />

      <div className="flex items-center justify-between border-t border-border/60 pt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={isStreaming || disabled}
              className="h-8 gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Cpu className="h-3.5 w-3.5 text-indigo-500" />
              <span>{activeModelObj.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {AVAILABLE_MODELS.map((model) => (
              <DropdownMenuItem
                key={model.id}
                onClick={() => setSelectedModel(model.id)}
                className="flex items-center justify-between text-xs"
              >
                <span>{model.name}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{model.badge}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-2">
          {isStreaming ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onCancel}
              className="h-8 gap-1.5 px-3 text-xs font-semibold"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={!prompt.trim() || disabled}
              onClick={handleSubmit}
              className="h-8 gap-1.5 bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generate
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

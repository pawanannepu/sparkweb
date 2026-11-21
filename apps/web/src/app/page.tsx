"use client";

import type { DeviceMode } from "@spark/shared";
import { ArrowUp, Sparkles } from "lucide-react";
import type * as React from "react";
import { useRef, useState } from "react";
import {
  BuilderShell,
  BuilderWorkbench,
  ChatPanel,
  PreviewFrame,
  PreviewToolbar,
} from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePreviewBridge } from "@/hooks/usePreviewBridge";

export default function BuilderPage() {
  const [device, setDevice] = useState<DeviceMode>("desktop");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<
    Array<{ id: string; role: "user" | "assistant"; content: string }>
  >([
    {
      id: "initial",
      role: "assistant",
      content:
        "Welcome to sparkweb! Describe the web application you want to build, or pick one of the suggestions below.",
    },
  ]);
  const [currentPath, setCurrentPath] = useState("/");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sandboxUrl = process.env.NEXT_PUBLIC_SANDBOX_URL || "/sandbox";

  const { isConnected, sendToPreview } = usePreviewBridge({
    iframeRef,
    targetUrl: sandboxUrl,
    onMessage: (msg) => {
      if (msg.type === "PREVIEW_NAVIGATE" && typeof msg.payload.path === "string") {
        setCurrentPath(msg.payload.path);
      }
    },
  });

  const handleSendPrompt = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim()) return;

    const userText = prompt.trim();
    setMessages((prev) => [
      ...prev,
      { id: String(Date.now()), role: "user", content: userText },
      {
        id: String(Date.now() + 1),
        role: "assistant",
        content: `Creating components and routes for "${userText}". The live preview will boot in the sandbox frame.`,
      },
    ]);
    setPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendPrompt();
    }
  };

  const [iframeKey, setIframeKey] = useState(0);

  const handleReload = () => {
    sendToPreview("PREVIEW_RELOAD", {});
    setIframeKey((prev) => prev + 1);
  };

  const handleNavigate = (newPath: string) => {
    setCurrentPath(newPath);
    sendToPreview("PREVIEW_NAVIGATE", { path: newPath });
  };

  return (
    <BuilderShell projectName="CRM Dashboard Demo">
      <BuilderWorkbench
        chatContent={
          <ChatPanel title="Prompt Assistant">
            <div className="flex h-full flex-col justify-between space-y-4">
              {/* Message List */}
              <div className="space-y-4 overflow-y-auto">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col space-y-1.5 ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {msg.role === "assistant" && <Sparkles className="h-3 w-3 text-primary" />}
                      <span>{msg.role === "user" ? "You" : "spark"}</span>
                    </div>
                    <div
                      className={`rounded-lg px-3.5 py-2.5 text-sm leading-relaxed max-w-[90%] ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground font-medium"
                          : "bg-card border border-border text-foreground shadow-sm"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>

              {/* Input Area with Quick Prompts */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    variant="outline"
                    className="cursor-pointer hover:bg-accent text-xs font-normal"
                    onClick={() =>
                      setPrompt("Add a user management table with search and pagination")
                    }
                  >
                    + Add user table
                  </Badge>
                  <Badge
                    variant="outline"
                    className="cursor-pointer hover:bg-accent text-xs font-normal"
                    onClick={() => setPrompt("Create a sales analytics chart widget")}
                  >
                    + Sales analytics chart
                  </Badge>
                </div>

                <form onSubmit={handleSendPrompt} className="relative">
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Describe what to add or adjust... (Enter to send, Shift+Enter for newline)"
                    className="pr-12 min-h-[80px] resize-none text-sm bg-card/60"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!prompt.trim()}
                    className="absolute bottom-2.5 right-2.5 h-7 w-7 rounded-full shadow-sm"
                    aria-label="Send prompt"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </div>
          </ChatPanel>
        }
        previewContent={
          <div className="flex h-full w-full flex-col">
            <PreviewToolbar
              activeDevice={device}
              onDeviceChange={setDevice}
              onReload={handleReload}
              currentPath={currentPath}
              onNavigate={handleNavigate}
              isConnected={isConnected}
              sandboxUrl={sandboxUrl}
            />
            <PreviewFrame
              key={iframeKey}
              iframeRef={iframeRef}
              src={sandboxUrl}
              device={device}
              className="flex-1"
            />
          </div>
        }
      />
    </BuilderShell>
  );
}

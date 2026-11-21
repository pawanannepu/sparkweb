export default function SandboxPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-muted/20">
      <div className="max-w-md p-6 rounded-xl border border-border bg-card shadow-sm space-y-3 text-center">
        <h2 className="text-lg font-bold">Isolated Sandbox Preview Runner</h2>
        <p className="text-sm text-muted-foreground">
          This runner executes inside dedicated cross origin headers supporting WebContainers and
          SharedArrayBuffer.
        </p>
        <div className="pt-2 text-xs text-muted-foreground font-mono bg-muted p-2 rounded">
          Cross-Origin-Embedder-Policy: credentialless
        </div>
      </div>
    </div>
  );
}

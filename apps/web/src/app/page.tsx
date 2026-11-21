import { Code2, Layers, Sparkles, Terminal } from "lucide-react";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-background text-foreground">
      <div className="max-w-2xl text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/40 text-sm font-medium">
          <Sparkles className="w-4 h-4 text-primary" />
          <span>sparkweb scaffold ready</span>
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Build full stack applications from natural language
        </h1>
        <p className="text-lg text-muted-foreground">
          In browser WebContainers, WASM PostgreSQL with PGlite, and isolated sandbox previews.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 text-left">
          <div className="p-4 rounded-lg border border-border bg-card">
            <Code2 className="w-5 h-5 text-primary mb-2" />
            <h3 className="font-semibold text-sm">Next.js App Router</h3>
            <p className="text-xs text-muted-foreground mt-1">
              React 19, TypeScript, and Tailwind CSS v3.4 foundation.
            </p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card">
            <Terminal className="w-5 h-5 text-primary mb-2" />
            <h3 className="font-semibold text-sm">Sandbox Runner</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Isolated route with credentialless embedder policies.
            </p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card">
            <Layers className="w-5 h-5 text-primary mb-2" />
            <h3 className="font-semibold text-sm">Database Layer</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Drizzle ORM client with connection pooling singleton.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

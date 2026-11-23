# 0005. Visual canvas inspector and direct styling (Rationale)

**Date**: 2026-11-22

## Context

Web application creators using natural language builders often struggle with fine cosmetic adjustments. Asking an AI model to make a button slightly more rounded, shift a header down eight pixels, or change a font size requires composing a prompt, waiting for the model planning and code generation stages, and triggering a full virtual file system update. This round trip can take up to thirty seconds for a single cosmetic tweak.

To make sparkweb feel like a professional visual development environment, creators need direct manipulation. They must be able to click any element in the live preview iframe, inspect its computed dimensions and current styles, and tweak properties using standard visual controls such as color pickers, spacing boxes, and typography menus. Furthermore, simple text updates like changing button labels or headline copy should happen directly on the canvas via inline text editing.

The primary technical challenge is maintaining strict synchronization between visual canvas adjustments and the underlying code tree across browser security boundaries. Because WebContainers host preview applications on an isolated origin, parent host frames cannot directly inspect child DOM trees. Furthermore, direct code modifications cannot cause file formatting churn or corrupt dynamic JSX expressions, and styling updates must translate cleanly into idiomatic Tailwind CSS classes while guaranteeing zero latency feedback.

## Options considered

### Option 1: Live DOM inspector overlay via Vite plugin injection with client AST Tailwind manipulation and dual bridge synchronization

This option pairs an in app DOM overlay script injected directly into the preview application via a Vite development plugin (`vite-plugin-spark-inspector`) with an in browser AST transformation engine running in the host workbench. The Vite plugin tags JSX elements with `data-source-loc` attributes during bundling and executes inside the preview origin, sending selection data to the host workbench via postMessage. When the creator modifies a styling control, the host immediately injects a style override into the preview iframe for zero latency visual feedback, and debounces writes to the WebContainer virtual file system using `recast` (preserving formatting) and `tailwind-merge` (resolving class collisions) on a centralized client file store. In addition, inline text editing is restricted to leaf static text nodes, and auto save commits the full project file tree to PostgreSQL after three seconds of inactivity.

**Pros**:
- Respects browser cross origin security policies by running the inspector client script inside the preview origin.
- Provides immediate visual feedback without waiting for compilation cycles or server network round trips.
- Produces clean, idiomatic Tailwind CSS classes while preserving existing code formatting, quotes, and comments.
- Protects dynamic React expressions and nested icons from text editing corruption.
- Eliminates concurrency collisions between visual styling and AI generation streams.

**Cons**:
- Requires bundling `recast` and `tailwind-merge` in the client bundle of the host application.
- Requires building a small custom Vite plugin to inject the inspector script during sandbox compilation.

### Option 2: Inline style injection with non AST regular expression replacement

This option avoids AST parsers by appending inline `style` attributes to elements directly via string regular expressions in the raw file text, rather than modifying Tailwind utility classes.

**Pros**:
- Lightweight implementation with no external AST parser dependencies in the client bundle.
- Fast string substitution for basic JSX markup.

**Cons**:
- Pollutes component source code with inline style attributes that conflict with Tailwind conventions.
- Fragile string parsing prone to syntax corruption on nested JSX elements and multi line attributes.
- Fails to leverage existing design tokens and utility classes established across the project.

### Option 3: Server side AST patching via remote worker endpoints

This option forwards every visual styling change to a server side API endpoint that executes AST parsing and returns updated source files to the client.

**Pros**:
- Keeps the client bundle size smaller by hosting the Babel or SWC compiler on the backend.
- Centralizes all code mutation logic in server side Next.js route handlers.

**Cons**:
- Introduces network latency on every slider drag and color picker adjustment.
- Increases server load and hosting costs substantially as creators perform hundreds of styling tweaks.
- Degrades the offline or client side editing experience within the WebContainer environment.

## Rationale

Option 1 is selected because it delivers an uncompromising creator experience while respecting browser security constraints. Running the inspector script inside the preview application via a Vite plugin is essential because WebContainers run preview applications on a distinct origin, making direct parent DOM access impossible under browser same origin policy.

By combining immediate CSS injection with debounced `recast` and `tailwind-merge` AST file writes, Option 1 achieves zero latency feedback without formatting churn. Using `recast` ensures that existing indentation, comments, and structure remain completely intact, avoiding massive git diffs that would otherwise degrade subsequent AI generation prompts.

Restricting inline text editing strictly to leaf static text nodes provides critical safety, preventing accidental deletion of icon components or dynamic React state bindings. Furthermore, centralizing the project file tree in workbench memory and locking inspector editing during active AI generation streams guarantees that PostgreSQL snapshot lineage remains clean, robust, and free of concurrency races.

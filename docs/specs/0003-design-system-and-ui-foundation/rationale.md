# 0003. Design system and UI foundation: Rationale

## Context

sparkweb is an application creator platform that allows users to prompt, generate, inspect, and run full stack applications inside the browser. Delivering this workflow requires an intuitive, high performance creator workbench. Creators must be able to describe application changes in a chat panel while observing instant live updates in a running preview container beside it.

Without a deliberated design system and UI foundation, application builder screens risk becoming fragmented, inaccessible to keyboard users, and uncomfortable during prolonged coding sessions. The workbench layout must balance the creator need for prompt conversation space with the need for broad live canvas area. Furthermore, running untrusted generated applications in preview requires strict security boundaries around the iframe container to protect host credentials and application integrity. Serving an iframe with allow-scripts and allow-same-origin from the exact same origin creates a browser security bypass where child scripts can read parent storage and DOM. Thus the preview runner must reside on a distinct origin boundary.

The technical constraints require supporting modern desktop and mobile browsers, ensuring zero visual style flash during server side rendering in Next.js, and meeting WCAG 2.1 AA accessibility guidelines.

## Options considered

### Option 1: Native CSS grid layout with custom pointer event drag divider

This option relies entirely on custom React state and native browser pointer events (pointerdown, pointermove, pointerup) to calculate panel widths, rendering a standard iframe element with basic styling.

**Pros**:
- Zero additional npm dependencies added to the web application bundle.
- Complete low level control over DOM event propagation and drag cursor rendering.

**Cons**:
- Lacks accessible keyboard controls for resizing panels (such as arrow key increments or Home and End keys) without building substantial custom ARIA logic.
- Requires building custom touch coordinate translation, mouse capture polyfills, and window boundary clamping from scratch.
- Incurred ongoing maintenance burden to handle edge cases like fast cursor exits across iframe boundaries during dragging.

### Option 2: Accessible Radix UI primitives with react-resizable-panels and dark mode first studio design tokens

This option pairs react-resizable-panels for flexible, accessible split pane layouts with Radix UI headless primitives for base controls, styled using Tailwind CSS v3.4 and dark mode first design tokens, backed by separate origin preview iframe sandboxing.

**Pros**:
- Provides accessible panel resizing with full keyboard navigation, ARIA attributes, and automatic percentage clamping.
- Resolves mouse capture over iframes automatically during dragging through pointer overlay masks.
- Base primitives (Button, Input, Tooltip, Dialog, Tabs) inherit robust accessibility, keyboard focus management, and screen reader announcements.
- Dark mode first design tokens create a unified, professional developer tool aesthetic that reduces eye fatigue during extended creative use.
- Separate origin boundary safely supports allow-scripts without compromising host credentials or local storage.

**Cons**:
- Adds focused runtime dependencies (react-resizable-panels and Radix UI packages).
- Requires an inline head script to prevent light mode flash before React hydration finishes.

### Option 3: All in one administrative dashboard template library

This option adopts a prebuilt third party dashboard framework (such as an off the shelf admin template or commercial component suite) providing fixed sidebar navigation, preset data tables, and preconfigured widgets.

**Pros**:
- Fast initial scaffolding of typical navigation headers and administrative account settings pages.

**Cons**:
- Monolithic template architectures resist custom split pane workbench interactions and interactive live preview containers.
- Imposes opinionated layout conventions that conflict with sparkweb's specialized creator requirements.
- Difficult to optimize bundle sizes or enforce strict zero flash server side rendering behaviors.

## Rationale

We choose Option 2. An AI code generation platform is fundamentally a developer and creator workbench rather than a generic administrative portal. Creators spend hours iteratively refining prompts and reviewing live software. A dark mode first aesthetic with subtle neutral surfaces and high contrast accents provides the visual focus necessary for sustained work.

react-resizable-panels is the industry standard for web based developer workbenches. It solves the critical problem of cursor events being swallowed when dragging a separator over an iframe, while guaranteeing full keyboard accessibility with arrow keys and collapse shortcuts. Coupling this with headless Radix UI primitives ensures every button, input, dialog, and tooltip meets WCAG 2.1 AA standards without imposing rigid styling opinions that would compromise our custom studio design tokens.

Crucially, hosting the preview iframe on a distinct origin boundary (such as 127.0.0.1:3000 vs localhost:3000 in development, or an isolated proxy subdomain in production) neutralizes the browser sandbox bypass that occurs when allow-scripts and allow-same-origin share the exact parent origin.

Option 1 was rejected because building accessible, cross browser drag handling with keyboard navigation and iframe overlay masking duplicates extensive engineering effort already proven in react-resizable-panels. Option 3 was rejected because prebuilt admin templates lack the specialized two pane builder mechanics, responsive viewport switchers, and iframe containment models central to sparkweb.

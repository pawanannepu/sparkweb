# 0003. Design system and UI foundation

**Date**: 2026-11-22
**Status**: In Progress

## Summary

This specification establishes the visual design system, accessible component library, resizable workbench layout, and isolated live preview container for sparkweb. We adopt a dark mode first studio aesthetic with high contrast accents and crisp borders, powered by Tailwind CSS v3.4 and accessible Radix UI primitives. The builder interface provides a responsive resizable split pane workbench using react-resizable-panels with local storage persistence and an isolated sandbox preview frame with multi device viewport controls.

## Requirements

**User stories**:
- As a creator, I want a clean, responsive builder interface with resizable chat and preview panels so that I can comfortably prompt and inspect my application simultaneously.
- As a creator, I want instant viewport switching between desktop, tablet, and mobile views so that I can verify how my generated application behaves across screen sizes.
- As a creator on a small laptop or tablet, I want to collapse the chat panel or toggle between views smoothly so that the preview canvas has maximum visible area.
- As a developer, I want accessible, type safe base UI primitives that conform to WCAG 2.1 AA guidelines so that the builder interface remains fully usable via keyboard.

**Acceptance criteria**:
- **AC-1**: Visual design tokens defining dark mode first colors, neutral background layers, high contrast accents, typography with Geist Sans and Geist Mono, and radius variables render cleanly with zero style flash on initial page load via a standalone theme script in head.
- **AC-2**: Core accessible UI primitives (Button, Input, Textarea, Tooltip, DropdownMenu, Dialog, Tabs, ScrollArea, Badge, Separator) render predictably, support keyboard navigation, expose focus rings meeting WCAG 2.1 AA contrast requirements, and export strict TypeScript props with standard visual variants.
- **AC-3**: Resizable split pane workbench mounts with a collapsible chat panel on the left and a live preview canvas on the right, supporting smooth drag resizing, pointer capture overlay shields during dragging, and keyboard collapse toggle via Cmd+B or Ctrl+B shortcuts that ignore active text inputs.
- **AC-4**: Workspace layout preferences (chat panel size, preview panel size, last expanded chat size, chat collapse state, active preview device mode, and theme mode) persist in browser local storage with debounced writes, restoring safely with schema validation fallback on corrupted values.
- **AC-5**: Responsive builder layout adapts on screen viewports narrower than 768px by offering a persistent bottom switcher to toggle between full screen chat view and full screen preview view, defaulting to chat view.
- **AC-6**: Live preview container renders an isolated iframe running on a dedicated cross origin preview boundary with sandbox attributes (allow-scripts, allow-same-origin, allow-forms, allow-popups) accompanied by a preview toolbar offering desktop (100%), tablet (768px by 1024px), and mobile (375px by 667px) device viewport presets, proportional scale down for narrow screens, manual reload trigger, and URL address display with Enter key navigation.
- **AC-7**: Typed postMessage event bridge connects the host builder window and the preview runner iframe with strict origin checking, handshake buffering until preview is ready, and connection state reset on iframe reload.

## Decision

**Chosen option**: Option 2: Accessible Radix UI primitives with react-resizable-panels and dark mode first studio design tokens

We establish a cohesive design system and UI foundation using Tailwind CSS v3.4, Radix UI accessible primitives, Geist typography, react-resizable-panels for workspace pane division, and an isolated iframe container with viewport presets and dedicated origin isolation.

**Implementation skills**: `next-dev-loop` (`vercel/next.js`, `.agents/skills/next-dev-loop/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:
Client state stored in browser local storage key `sparkweb:layout:v1`:
- `version`: number (integer 1)
- `chatPanelSize`: number (percentage between 15 and 50, default 30)
- `previewPanelSize`: number (percentage between 50 and 85, default 70)
- `lastExpandedChatSize`: number (percentage between 15 and 50, default 30, used to restore width after uncollapsing)
- `isChatCollapsed`: boolean (default false)
- `previewDevice`: string enum ('desktop' | 'tablet' | 'mobile', default 'desktop')
- `updatedAt`: string (ISO 8601 timestamp)

Standalone theme stored in browser local storage key `sparkweb:theme`:
- Value: string enum ('dark' | 'light' | 'system', default 'dark')
- Read by an inline script in `<head>` wrapped in a try catch block. If set to 'system', queries `window.matchMedia('(prefers-color-scheme: dark)').matches` to toggle document class `.dark`.

In memory postMessage bridge message schema between host and sandbox iframe:
- `protocol`: string literal 'sparkweb:bridge:v1'
- `type`: string enum ('PREVIEW_READY' | 'PREVIEW_NAVIGATE' | 'PREVIEW_RELOAD' | 'PREVIEW_ERROR' | 'PREVIEW_RESIZE' | 'PREVIEW_HEARTBEAT')
- `source`: string enum ('sparkweb:host' | 'sparkweb:sandbox')
- `payload`: record object (path string, error message, or dimension numbers)
- `timestamp`: number (epoch milliseconds)

**Component contracts for UI primitives**:
`apps/web/src/components/ui/` exports standard, accessible primitives:
- `Button`: props `variant` ('default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'), `size` ('default' | 'sm' | 'lg' | 'icon'), `asChild?: boolean`, `isLoading?: boolean`, extends `ButtonHTMLAttributes<HTMLButtonElement>`.
- `Input`: extends `InputHTMLAttributes<HTMLInputElement>`, with styled focus rings and error states.
- `Textarea`: extends `TextareaHTMLAttributes<HTMLTextAreaElement>`, with auto resize and focus styling.
- `Badge`: props `variant` ('default' | 'secondary' | 'outline' | 'destructive' | 'success'), extends `HTMLAttributes<HTMLDivElement>`.
- `Tooltip`: exports `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent` (Radix UI wrapper).
- `DropdownMenu`: exports `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`, `DropdownMenuLabel`.
- `Dialog`: exports `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`.
- `Tabs`: exports `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`.
- `ScrollArea`: exports `ScrollArea`, `ScrollBar` (Radix UI wrapper for custom accessible scrollbars).
- `Separator`: props `orientation` ('horizontal' | 'vertical'), `decorative?: boolean`.

**API surface**:
Component and client library surface in `apps/web/src/`:
| Module / Component | Type | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `BuilderShell` | React Component | children: ReactNode, projectName?: string, headerActions?: ReactNode | Root layout container with top navigation bar and theme toggle | Session optional | None |
| `BuilderWorkbench` | React Component | chatContent: ReactNode, previewContent: ReactNode | Resizable two pane workbench with drag overlay mask | Public | None |
| `PreviewToolbar` | React Component | activeDevice: DeviceMode, onDeviceChange: (d: DeviceMode) => void, onReload: () => void, currentPath: string, onNavigate: (path: string) => void | Toolbar controls with device switcher, reload action, and address bar | Public | Invalid URL path |
| `PreviewFrame` | React Component | src: string, device: DeviceMode, onBridgeMessage?: (msg: BridgeMessage) => void, isDragging?: boolean | Sandboxed iframe wrapped in dimension container with pointer overlay shield | Public | Sandbox load error |
| `useWorkspaceLayout` | React Hook | initialDefaults?: Partial<LayoutPreferences> | preferences: LayoutPreferences, updatePreferences: (p) => void, toggleChatCollapse: () => void, resetPreferences: () => void | Public | Storage quota exceeded |
| `useTheme` | React Hook | defaultTheme?: 'dark' | theme: ThemeMode, setTheme: (t: ThemeMode) => void, resolvedTheme: 'dark' | 'light' | Public | None |
| `usePreviewBridge` | React Hook | iframeRef: RefObject<HTMLIFrameElement>, targetUrl: string | sendToPreview: (type, payload) => void, lastMessage: BridgeMessage | null, isConnected: boolean | Public | Untrusted origin message |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Mount builder workbench | Initial split pane widths | Read from local storage key `sparkweb:layout:v1`, default 30% chat and 70% preview, normalized to 100% sum |
| Collapse chat panel | Zero width left pane and collapsed button state | User click on collapse trigger or Cmd+B shortcut, sets `isChatCollapsed: true` and preserves `lastExpandedChatSize` |
| Restore chat panel | Restored left pane width | User click on expand trigger or Cmd+B shortcut, sets `isChatCollapsed: false` and restores width from `lastExpandedChatSize` |
| Switch preview viewport | Sized iframe canvas (375x667 mobile, 768x1024 tablet, 100% desktop) | User selection on `PreviewToolbar`, sets `previewDevice` enum |
| Scale down preview canvas | CSS transform scale factor on preview container | Computed dynamically when available preview container width is smaller than selected device preset width |
| Navigate preview path | New route loaded in preview iframe | User types path in `PreviewToolbar` address bar and presses Enter, emits `PREVIEW_NAVIGATE` via bridge |
| Mount root layout | Document html `.dark` class | Standalone inline script in `<head>` reading local storage key `sparkweb:theme` before React hydration |
| Drag panel separator | Pointer events overlay shield active | Drag handle `onDraggingChange(true)` mounts an invisible absolute overlay over iframe to prevent pointer capture loss |
| Reload preview iframe | Refreshed preview application state | Host posts `PREVIEW_RELOAD` message, or increments iframe key on hard reset |
| Handle iframe postMessage | Handled bridge action or logged error | Verified `event.data` payload matching `protocol: sparkweb:bridge:v1` and trusted origin resolved via `new URL(targetUrl, window.location.origin).origin` |

**Key invariants**:
- The builder workbench layout never blocks user interaction; if local storage data is corrupted or fails Zod validation, it resets to default values without throwing uncaught runtime exceptions.
- Chat panel width cannot be dragged smaller than 15% or larger than 50% when expanded, ensuring the live preview canvas always preserves at least 50% of the screen.
- Layout writes to local storage are debounced on drag completion (`onLayoutChangeEnd`) to avoid main thread frame drops during active resizing.
- Keyboard collapse shortcut Cmd+B or Ctrl+B is disabled whenever `document.activeElement` is an input, textarea, or contentEditable element, preventing interference with standard text editing.
- Iframe sandbox attributes must never include `allow-top-navigation`, preventing untrusted preview code from navigating or replacing the host builder window.
- Theme switching updates both the root document class list and local storage synchronously to prevent visual mismatch during client transitions.

**Security model**:
- All preview content executes within a dedicated iframe running on a separate host boundary (for example, `http://127.0.0.1:3000` while host runs on `http://localhost:3000` during development, or an isolated preview proxy domain). This separate origin prevents scripts inside the iframe from accessing parent window cookies, localStorage, or DOM trees even when `allow-scripts` and `allow-same-origin` are active.
- Iframe sandbox flags are restricted to `allow-scripts allow-same-origin allow-forms allow-popups`.
- Window message event listeners strictly validate `event.origin` against the absolute origin computed from `new URL(NEXT_PUBLIC_SANDBOX_URL, window.location.origin).origin`.
- Outgoing host commands are queued in an internal buffer until a verified `PREVIEW_READY` handshake message is received from the preview runner.
- No user credentials, authentication tokens, or personal API keys are ever stored in unencrypted client local storage.

**Configuration required**:
- `NEXT_PUBLIC_SANDBOX_URL`: URL of the sandbox preview runner route (defaults to `http://127.0.0.1:3000/sandbox` in development to ensure separate origin isolation from `localhost`).

**Critical test scenarios**:
- Happy path: User opens builder, drags split pane handle to adjust width, switches viewport to tablet, and reloads page; verified layout and device settings remain persisted, verifies **AC-3**, **AC-4**, **AC-6**
- Collapse and restore: User presses Cmd+B to collapse chat, verifies panel collapses to 0; presses Cmd+B again, verifies panel restores to previous width, verifies **AC-3**, **AC-4**
- Failure case: Corrupted JSON string placed in local storage; page loads cleanly, resets layout to default state, and logs warning without crash, verifies **AC-4**
- Responsive behavior: Browser viewport resized below 768px; split pane collapses into single column view with bottom switcher toggling chat and preview panels, verifies **AC-5**
- Accessibility check: User navigates toolbar, buttons, and inputs purely using Tab, Shift+Tab, and Enter keys; focus rings remain clearly visible and panel collapse responds to Cmd+B or Ctrl+B, verifies **AC-2**, **AC-3**
- Security isolation check: Sandbox iframe running on separate origin boundary attempts cross context parent DOM access; browser blocks access under cross origin policy, verifies **AC-6**, **AC-7**
- Drag overlay shield: Resizing separator over iframe continues smoothly without cursor sticking when pointer moves across the iframe boundary, verifies **AC-3**

## Build plan

Following the Tracer Bullet build approach, tasks deliver a thin end to end thread first through visual tokens, workbench layout, and isolated preview container, then thicken with accessible controls and responsive handling.

- [x] 1. Configure dark mode first studio design tokens, neutral surface palette, and standalone theme head script in `apps/web/src/app/globals.css` and `apps/web/src/app/layout.tsx`, satisfies **AC-1**
- [x] 2. Install `react-resizable-panels` dependency and construct core accessible base primitives (Button, Input, Textarea, Tooltip, DropdownMenu, Dialog, Tabs, ScrollArea, Badge, Separator) in `apps/web/src/components/ui/`, satisfies **AC-2**
- [x] 3. Create `useWorkspaceLayout` and `useTheme` hooks with Zod schema validation, debounced local storage persistence, and last expanded size restoration in `apps/web/src/hooks/`, satisfies **AC-4**
- [x] 4. Build `BuilderShell`, resizable `BuilderWorkbench`, collapsible `ChatPanel`, and drag overlay shield with keyboard shortcut support in `apps/web/src/components/layout/`, satisfies **AC-3**
- [x] 5. Implement responsive mobile layout with persistent bottom switcher bar for screens under 768px in `apps/web/src/components/layout/`, satisfies **AC-5**
- [x] 6. Build `PreviewToolbar` and `PreviewFrame` with isolated iframe sandbox attributes, URL address bar with Enter navigation, and device viewport presets (desktop, tablet, mobile) with auto scale down, satisfies **AC-6**
- [x] 7. Implement typed postMessage bridge hook `usePreviewBridge` with strict origin verification and handshake buffering in `apps/web/src/hooks/`, satisfies **AC-7**
- [x] 8. Create automated smoke and unit tests validating keyboard navigation, focus ring contrast, storage persistence, panel collapse restoration, and origin verification, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-7**

## Consequences

**Positive**:
- Creators enjoy an instant, responsive workbench layout with smooth panel resizing, reliable collapse restoration, and persistent screen preferences.
- Dark mode first studio styling gives sparkweb a modern, professional developer tool aesthetic with zero flash on initial load.
- Strict separate origin iframe sandbox boundaries isolate generated application execution from host authentication and workspace state.
- Standardized Radix UI primitives guarantee full keyboard accessibility and screen reader support from day one.
- Responsive mobile mode allows creators to inspect generations and review prompt threads on tablet and mobile devices.

**Negative / tradeoffs**:
- Local storage preferences are device specific and do not automatically sync across different computers without account cloud sync.
- Very small screen viewports (mobile phones) cannot display chat and live preview side by side, requiring user switching via bottom bar.
- Iframe sandbox restrictions require careful postMessage proxying for advanced capabilities like device camera or geolocation if needed in generated applications.

**Neutral**:
- Future visual canvas inspection (Slice 2) will build directly on top of this preview container using the established postMessage bridge.

## Follow-up

- [ ] Connect the visual canvas inspector postMessage handlers in Slice 2 to highlight elements in the live preview iframe
- [ ] Add optional cloud backup for workspace layout preferences when user account sync is implemented in later slices

# Verify: Design system and UI foundation · spec 0003 · updated 2026-11-22

_Steps derived from spec 0003 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Load `http://localhost:3000` in browser → dark mode first studio layout renders with clean typography and zero style flash → AC-1
- [x] Test keyboard navigation on buttons, inputs, dialogs, dropdowns, and tabs using Tab, Shift+Tab, and Enter → focus ring is visible with contrast ratio meeting or exceeding 3:1 → AC-2
- [x] Drag resizer handle between chat and preview → panel resizes smoothly without cursor sticking over iframe → AC-3
- [x] Press Cmd+B (or Ctrl+B) on desktop → chat panel collapses to zero width; press Cmd+B again → chat panel restores to previous width → AC-3
- [x] Type inside prompt textarea and press Cmd+B → cursor remains in textarea and panel does not collapse → AC-3
- [x] Switch preview toolbar device viewport to Tablet (768px) and Mobile (375px) → iframe container sizes properly with auto scale down → AC-6
- [x] Enter path `/settings` in address bar and press Enter → bridge emits `PREVIEW_NAVIGATE` to iframe → AC-6, AC-7
- [x] Click theme toggle dropdown and switch to Light mode → root document class updates and preference persists in local storage → AC-1, AC-4
- [x] Resize browser viewport below 768px → layout switches to mobile single view with bottom switcher bar → AC-5
- [x] Verify sandbox iframe has sandbox attribute set to `allow-scripts allow-same-origin allow-forms allow-popups` → AC-6

## Commands

- [x] `pnpm check-types` → zero TypeScript errors across all workspaces → AC-2
- [x] `pnpm lint` → Biome checks pass with zero errors and zero warnings → AC-1, AC-2
- [x] `pnpm test` → 87 unit and smoke tests pass cleanly across all packages → AC-1, AC-2, AC-3, AC-4, AC-7

## Acceptance criteria coverage

- AC-1 (design tokens, typography, zero flash) covered by manual step 1, 8 and command step 2, 3
- AC-2 (accessible base primitives and focus contrast) covered by manual step 2 and command step 1, 2, 3
- AC-3 (resizable workbench, drag shield, keyboard shortcut) covered by manual step 3, 4, 5 and command step 3
- AC-4 (local storage persistence, restoration) covered by manual step 4, 8 and command step 3
- AC-5 (responsive mobile layout and switcher) covered by manual step 9
- AC-6 (preview container, toolbar, device presets) covered by manual step 6, 7, 10
- AC-7 (postMessage bridge and origin verification) covered by manual step 7 and command step 3

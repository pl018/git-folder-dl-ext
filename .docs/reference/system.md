# Wisper Clone Design System

> Extracted from 42 TSX + 31 CSS files on 2026-02-21
> Aesthetic: Neobrutalist dark mode with dual-theme support

---

## Spacing

**Base unit:** 4px

| Token | Value | Usage |
|-------|-------|-------|
| xs    | 2px   | Micro adjustments |
| sm    | 4px   | Tight inner spacing |
| md    | 6px   | Compact gaps |
| lg    | 8px   | Default gap, button padding |
| xl    | 12px  | Comfortable spacing |
| 2xl   | 16px  | Section padding, form gaps |
| 3xl   | 20px  | Card padding |
| 4xl   | 24px  | Major section spacing |
| 5xl   | 32px  | Page-level spacing |
| 6xl   | 40px  | Large containers |
| 7xl   | 60px  | Full-page padding |

**Unit preference:** px for layout/cards, rem for forms/modals, em rare (typography-relative only).

---

## Border Radius

| Token    | Value | Usage |
|----------|-------|-------|
| subtle   | 3px   | Minimal corners, tags |
| default  | 4px   | Inputs, small buttons |
| medium   | 6px   | Standard buttons, badges |
| large    | 8px   | Cards, modals (--radius) |
| xl       | 10px  | Rounded cards |
| 2xl      | 12px  | Large containers |
| pill     | 999px | Pill buttons |
| circle   | 50%   | Avatars, toggles |

**CSS variable:** `var(--radius)` defaults to `8px`.

---

## Depth

**Strategy:** Borders-primary + brutalist hard shadows

| Layer | Method | Value |
|-------|--------|-------|
| Flat  | Border | `1px solid var(--border-primary)` |
| Raised | Hard shadow | `var(--shadow-hard)` — `2-3px 2-3px 0 0` offset, no blur |
| Floating | Soft shadow | `0 4px 16px rgba(0,0,0,0.15-0.4)` |
| Overlay | Combined | Hard shadow + soft shadow |
| Focus | Ring | `0 0 0 1px var(--accent-primary)` |

**Interaction:** `transform: translate(2px, 2px)` on `:active` (press-down effect).

**Border widths:**
- Standard: `1px solid` (dominant)
- Emphasis: `2px solid` (modal headers, active states)
- Accent: `3px solid var(--accent-primary)` (rare, high emphasis)
- Dashed: `1px dashed var(--border-primary)` (empty states, dropzones)

---

## Colors

### Theme Variables

| Variable | Light | Dark |
|----------|-------|------|
| `--bg-primary` | `#f5f5f5` | `#09090b` |
| `--bg-secondary` | `#ffffff` | `#18181b` |
| `--bg-tertiary` | `#f9fafb` | `#27272a` |
| `--text-primary` | `#1a1a1a` | `#fafafa` |
| `--text-secondary` | `#6b7280` | `#a1a1aa` |
| `--text-tertiary` | `#9ca3af` | `#71717a` |
| `--border-primary` | `#e5e5e5` | `#27272a` |
| `--border-secondary` | `#d1d5db` | `#3f3f46` |
| `--accent-primary` | `#3b82f6` | `#ccff00` |
| `--accent-hover` | `#2563eb` | `#b3e600` |
| `--accent-fg` | `#ffffff` | `#000000` |
| `--shadow` | `rgba(0,0,0,0.1)` | `rgba(0,0,0,0.3)` |
| `--shadow-lg` | `rgba(0,0,0,0.15)` | `rgba(0,0,0,0.5)` |
| `--shadow-hard` | `3px 3px 0 0 rgba(0,0,0,0.1)` | `3px 3px 0 0 #27272a` |

### Category Colors (fixed, theme-independent)

| Category | Color |
|----------|-------|
| Action | `#f59e0b` |
| Spec | `#3b82f6` |
| Architecture | `#8b5cf6` |
| Ops | `#06b6d4` |
| Tooling | `#10b981` |
| Debug | `#ef4444` |
| Research | `#ec4899` |
| Reference | `#6366f1` |
| Meeting | `#14b8a6` |
| Idea | `#a855f7` |
| Default | `#6b7280` |

### Computed Tints (color-mix)

Pattern: `color-mix(in srgb, <color> <percent>%, transparent)`
- Subtle: 8-10% (active sidebar items)
- Light: 12-15% (badges, chips)
- Medium: 25% (active chips)

---

## Typography

### Scale

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| caption | 10px | 500-600 | Tooltips, timestamps |
| small | 11px | 500-600 | Secondary labels |
| label | 12px | 600-700 | Button text, form labels |
| body-sm | 13px | 500 | Navigation, compact body |
| body | 14px | 500 | Default body text |
| heading-sm | 16px | 700 | Section headings |
| heading | 18-20px | 700-800 | Page section headers |
| title | 24px | 800 | Page titles |

### Properties

- **Family:** `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif`
- **Monospace:** `monospace` (system prompts, code blocks)
- **Letter-spacing:** `0.03em` default for labels, `0.05em` for high-emphasis caps
- **Text-transform:** `uppercase` for all labels, buttons, section headers
- **Line-height:** `1.4-1.5` body, `1.6` loose body, `1` compact/icons

---

## Components

### Button

```
Height:       40px (standard), 28-32px (icon/compact)
Padding:      12-16px vertical, 16-20px horizontal
Border:       1px solid var(--border-primary)
Radius:       6-8px (standard), 999px (pill)
Font:         12-14px, weight 600-700, uppercase, 0.02em spacing
Active:       transform: translate(2px, 2px)
Transition:   all 0.15s ease-in-out
```

**Base class:** `.btn-neo`

### Input

```
Height:       36-40px
Padding:      10-12px
Border:       1px solid var(--border-primary)
Radius:       6-8px
Background:   var(--bg-secondary)
Focus:        border-color: var(--accent-primary) + box-shadow ring
Font:         12-14px, weight 400-500
```

**Base class:** `.input-neo`

### Textarea

```
Min-height:   80-120px (contextual)
Padding:      10-12px
Resize:       vertical
Line-height:  1.4-1.6
```

**Base class:** `.textarea-neo`

### Card

```
Padding:      16-32px (20px most common)
Border:       1px solid var(--border-primary)
Radius:       8-10px
Background:   var(--bg-secondary)
Shadow:       var(--shadow-hard) (dark theme)
```

**Base class:** `.card-neo`

### Modal

```
Max-height:   90vh
Padding:      20-24px
Radius:       8-12px
Overlay:      rgba(0, 0, 0, 0.5)
Shadow:       0 20px 50px rgba(0, 0, 0, 0.5)
```

---

## Layout

**System:** Flexbox-only (no CSS Grid)

### Common Patterns

| Pattern | Properties | Usage |
|---------|-----------|-------|
| Center | `align-items: center; justify-content: center` | Modals, empty states |
| Bar | `align-items: center; justify-content: space-between` | Headers, toolbars |
| Stack | `flex-direction: column; gap: 12px` | Forms, lists |
| Fill | `flex: 1; overflow: hidden` | Content regions |
| Shrink-proof | `flex: 0 0 auto` | Fixed-size children |

### Gap Scale

| Context | Gap |
|---------|-----|
| Tight | 4-6px |
| Default | 8px |
| Comfortable | 12px |
| Generous | 16px |
| Section | 24px |

---

## Transitions

- **Default:** `all 0.15s ease-in-out`
- **Color-only:** `background-color 0.15s, border-color 0.15s`
- **Slide panels:** CSS transform with `0.3s ease`

---

## Design Principles

1. **Brutalist foundation** — Hard shadows, uppercase labels, 1px borders, press-down interactions
2. **Dual theme** — Light (blue accent, soft shadows) / Dark (lime accent, hard shadows)
3. **CSS variables first** — Theme tokens for 95% of colors, raw hex only for fixed categories
4. **Borders over shadows** — Borders define structure, shadows add optional elevation
5. **Uppercase everything** — Labels, buttons, section headers use `text-transform: uppercase`
6. **Inter typeface** — Single font family with weight-based hierarchy (500-800)
7. **Flexbox layout** — No Grid; flex-direction + gap for all layouts
8. **color-mix() for tints** — Computed transparent backgrounds from theme variables

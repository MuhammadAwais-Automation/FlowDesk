# FlowDesk — UI Design Guide

> Design system, colors, fonts, layout, aur visual language.

---

## Design Philosophy

- **Clean & Soft** — Hard shadows nahi, border-radius generous
- **Light mode only** — No dark mode
- **Minimal chrome** — Content-first, no clutter
- **Consistent accent** — One primary blue throughout

---

## Color System

### CSS Variables (defined in `src/index.css` or `src/styles/`)

```css
:root {
  /* Background layers */
  --bg:        #FFFFFF;        /* Main page background */
  --surface:   #F8F9FC;        /* Card/panel background */
  --surface-2: #F1F3F9;        /* Hover states */
  --surface-3: #E4E8F0;        /* Inactive/disabled */

  /* Border */
  --border:    #E2E6F0;        /* Default border */
  --border-2:  #CDD3E0;        /* Stronger border */

  /* Text */
  --text:      #0F172A;        /* Primary text (near-black) */
  --text-2:    #475569;        /* Secondary text (slate-600) */
  --text-3:    #94A3B8;        /* Muted text (slate-400) */

  /* Accent (primary blue) */
  --accent:    #4F6EF7;        /* Primary blue */
  --accent-2:  rgba(79, 110, 247, 0.08);  /* Very light blue tint */
  --accent-3:  rgba(79, 110, 247, 0.15);  /* Hover tint */

  /* Status */
  --success:   #22C55E;        /* Green */
  --error:     #EF4444;        /* Red */
  --warning:   #F59E0B;        /* Amber (variables) */
}
```

### Tailwind Config Extension
```javascript
// tailwind.config.js
theme: {
  extend: {
    colors: {
      accent: '#4F6EF7',
      surface: '#F8F9FC',
    },
    fontFamily: {
      display: ['Outfit', 'sans-serif'],
      sans: ['DM Sans', 'sans-serif'],
      mono: ['JetBrains Mono', 'monospace'],
    }
  }
}
```

---

## Typography

| Role | Font | Weight | Size |
|------|------|--------|------|
| App name/Logo | Outfit | 700 | 18px |
| Page titles | Outfit | 600 | 24px |
| Section headings | DM Sans | 600 | 14px |
| Body text | DM Sans | 400 | 14px |
| Small/meta text | DM Sans | 400 | 12px |
| Code | JetBrains Mono | 400 | 13px |
| Nav labels | DM Sans | 500 | 13px |

---

## Spacing & Sizing

| Element | Size |
|---------|------|
| Sidebar width (default) | 172px |
| Sidebar width (collapsed) | 48px |
| Sidebar width (min) | 120px |
| Sidebar width (max) | 280px |
| Tab bar height | 44px |
| YT account bar height | 52px |
| Border radius (card) | 12px |
| Border radius (button) | 8px |
| Border radius (pill) | 9999px |
| Border radius (input) | 6px |

---

## Component Specs

### Buttons

```
Primary:
  bg: var(--accent)  #4F6EF7
  text: white
  hover: #3D5CE8 (darken 10%)
  radius: 8px
  padding: 8px 16px
  font: DM Sans 500 14px

Secondary/Outline:
  bg: transparent
  border: 1px solid var(--border)
  text: var(--text-2)
  hover: bg var(--surface-2)

Ghost:
  bg: transparent
  text: var(--text-2)
  hover: bg var(--surface-2)

Destructive:
  bg: #FEE2E2 (red-100)
  text: #DC2626 (red-600)
  hover: #FECACA (red-200)
```

### Inputs

```
Default:
  bg: white
  border: 1px solid var(--border)
  focus: border-color var(--accent), ring rgba(79,110,247,0.2)
  radius: 6px
  padding: 8px 12px
  font: DM Sans 14px
```

### Cards

```
bg: white
border: 1px solid var(--border)
border-radius: 12px
padding: 16px
shadow: 0 1px 3px rgba(0,0,0,0.06)

Hover (interactive cards):
  shadow: 0 4px 12px rgba(0,0,0,0.08)
  transform: translateY(-2px)
  transition: 150ms ease
```

### Nav Items

```
Height: 36px
Padding: 0 12px
Radius: 8px
Margin: 2px 8px

Active:
  border-left: 2px solid var(--accent)
  bg: var(--accent-2)
  text: var(--accent)
  margin-left: 6px (to show border)

Hover:
  bg: var(--surface-2)
  text: var(--text)
```

### Stat Cards

```
┌─────────────────┐
│  Icon (24px)    │
│                 │
│  42             │  ← number, Outfit 700 32px
│  Total Prompts  │  ← label, DM Sans 400 13px text-3
└─────────────────┘

bg: white
border: 1px solid var(--border)
radius: 12px
padding: 20px
```

### Tabs (inside page)

```
Active tab:
  border-bottom: 2px solid var(--accent)
  color: var(--accent)
  font-weight: 500

Inactive:
  color: var(--text-2)
  hover: color var(--text)
```

### Browser Tab (AIBrowser)

```
Height: 44px
Padding: 0 12px 0 10px
Radius: 8px 8px 0 0 (top corners)

Active:
  bg: gmail.bg (account color, full opacity)
  border-left: 2px solid gmail.border
  text: gmail.text

Inactive:
  bg: gmail.bgLight (account color, low opacity)
  text: gmail.textLight

Close button (×):
  Appears on hover
  18px × 18px
  rounded-full
  hover: bg rgba(0,0,0,0.1)
```

### Gmail/YT Avatar Pill

```
Avatar: 28px circle, initials (2 chars), color bg
Label: DM Sans 13px
Padding: 6px 12px 6px 6px
Radius: 9999px (full pill)
Border: 1px solid (account color)

Active indicator dot:
  6px × 6px circle
  absolute positioned
  bottom-0 right-0
  color: gmail.dot
  box-shadow: 0 0 6px (glow effect)
```

---

## Animation & Transitions

```css
/* Standard transition */
transition: all 150ms ease;

/* Overlay appear */
.overlay-enter {
  opacity: 0;
  transform: translateY(-4px);
}
.overlay-enter-active {
  opacity: 1;
  transform: translateY(0);
  transition: 200ms ease;
}

/* Card hover lift */
.card:hover {
  transform: translateY(-2px);
  transition: transform 150ms ease, box-shadow 150ms ease;
}

/* Toggle switch */
.toggle-thumb {
  transition: transform 150ms ease;
}
```

---

## Layout Structure

### Full App Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                    BrowserWindow (1200×780)                      │
│                                                                 │
│  ┌──────────────┬──────────────────────────────────────────┐   │
│  │              │                                          │   │
│  │   LeftNav    │         Page Content                     │   │
│  │   172px      │         (remaining width)                │   │
│  │              │                                          │   │
│  │ (resizable)  │                                          │   │
│  │              │                                          │   │
│  └──────────────┴──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### AIBrowser Layout (with native view)

```
┌──────────────┬──────────────────────────────────────────────────┐
│              │  [Tab 1] [Tab 2] [+] [⚙]          ← 44px        │
│   LeftNav    ├──────────────────────────────────────────────────┤
│              │                                                  │
│              │    WebContentsView (native browser)             │
│              │    x=172, y=84, w=win.w-172, h=win.h-84        │
│              │                                                  │
└──────────────┴──────────────────────────────────────────────────┘
```

### Accounts Page (Gmail tab active)

```
┌──────────────┬─────────────────┬────────────────────────────────┐
│              │                 │  [Info]  [Gmail]               │
│   LeftNav    │  Account List   │                                │
│              │  (200px)        │  WebContentsView (Gmail inbox) │
│              │                 │  custom bounds via             │
│              │                 │  setCustomBounds(x, y, w, h)  │
│              │                 │                                │
└──────────────┴─────────────────┴────────────────────────────────┘
```

---

## Icon Library

Using **lucide-react** (`^0.344.0`):

```typescript
import {
  Globe,            // AI Browser
  Users,            // Accounts
  Youtube,          // YT Studio
  Calendar,         // Workspace
  Settings,         // Settings
  Zap,              // Logo
  Plus,             // Add buttons
  X,                // Close/remove
  Search,           // Search inputs
  ChevronLeft,      // Nav collapse
  ChevronRight,     // Nav expand
  Star,             // Favorite
  Copy,             // Copy to clipboard
  Trash2,           // Delete
  Edit,             // Edit
  History,          // Version history
  Check,            // Success state
  AlertCircle,      // Error state
  RefreshCw,        // Reload
  LogOut,           // Logout
  ExternalLink,     // Open external
} from 'lucide-react';
```

Default icon size: `16px` (w-4 h-4) in most places, `20px` in nav, `24px` in stat cards.

---

## Responsive Behavior

FlowDesk is a desktop app. Min window: 900×600.

- **Sidebar collapse**: At any width, user can collapse sidebar to 48px
- **3-pane layouts**: At narrow widths, middle pane may shrink
- **WebContentsView**: Always fills remaining space (recalculated on resize)
- No mobile breakpoints needed

---

## Z-Index Layers

```
1   → Base content (pages)
10  → Sidebar
20  → Tooltips, dropdowns
30  → Modals backdrop
40  → Modals
50  → Inject overlay (full-screen React overlay hiding native view)
100 → Toast notifications
```

---

## Accessibility

- `role="switch"` on toggles with `aria-checked`
- Keyboard navigable inputs (Tab order)
- Focus rings on interactive elements (accent color)
- `aria-label` on icon-only buttons
- Contrast: text on white backgrounds meets WCAG AA

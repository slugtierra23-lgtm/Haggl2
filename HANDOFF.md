# Handoff — haggl launch sprint

**Launch: mañana.** Dos agentes Claude trabajan en paralelo sobre `main`. Lee esto entero antes de empezar y haz `git pull --rebase origin main` al arranque y antes de cada commit.

---

## Reparto de trabajo

| Zona | Dueño |
|---|---|
| `frontend/src/app/profile/**` | **Agente B** (perfil + integrations) |
| `frontend/src/app/market/**` | Agente A |
| `frontend/src/app/page.tsx` | Agente A (landing) |
| `frontend/src/components/layout/**` (ClientShell, Sidebar, FloatingTopBar, UnifiedHeader) | Agente A |
| `frontend/src/components/ui/RenderHero.tsx` | Agente A |
| `frontend/src/components/ui/*` (el resto: GradientText, ShimmerButton, etc.) | **compartido — solo lectura, nunca editar sin avisar** |
| `backend/**` | nadie de frontend lo toca |

Si necesitas tocar algo fuera de tu zona, commitea primero lo tuyo, avisa al humano, y espera confirmación. **Nunca force-push a `main`.**

---

## Estado actual (commits relevantes, más reciente primero)

- `6ca43be fix(landing,nav): responsive hero + remove menu/topbar overlap`
  - `RenderHero.tsx`: hardcoded 80px → `clamp(36px, 9vw, 80px)`; grid 16-col → single-column <lg; padding `px-6 sm:px-10`.
  - `Sidebar.tsx`: botón menú 40×40 (antes gigante); `z-60`; drawer `82%` / `max-w-300px`; backdrop `bg-black/70 + blur-md`.
  - `FloatingTopBar.tsx`: en móvil ahora `right-4` (antes `left-4` — chocaba con botón menú); chip Home oculto en móvil; dropdown perfil flipea a `right-0`.

- `e96c2c9 fix(shell,market): remove nav jank + mobile responsive pass`
  - `ClientShell.tsx`: quitado `AnimatePresence mode="wait"` + timeout fake 500ms que bloqueaban cambios de ruta. `min-w-0` en flex-child.
  - `/market/page.tsx` + subpaginas (agents, repos, library, sellers, tags, favorites, seller, agents/[id], sellers/[username]): hero stacked en móvil, tipografía escalada `text-2xl sm:text-3xl lg:text-4xl`, paddings `px-4 sm:px-6 py-6 sm:py-10`, CTAs full-width móvil, breadcrumbs/chips con scroll horizontal.

- `e268de9` … commits anteriores fueron polish de micro-interacciones (layoutId glides) — no críticos.

---

## Convenciones (de `CLAUDE.md` raíz)

- **Brand**: `#836EF9` (púrpura primario). Acentos `#06B6D4` (cyan), `#EC4899` (magenta). Buenos (`#22c55e`).
- **Tipografía**: `font-light` (300) por defecto. `text-[clamp(Xpx, Yvw, Zpx)]` para escalar fluidamente.
- **Primitives a reutilizar** (`frontend/src/components/ui/`): `GradientText`, `ShimmerButton`, corner brackets (`border-t-2 border-l-2 border-white/20 rounded-tl-2xl`), glows ambient radial absolute-positioned.
- **Empty states**: nunca dejar una lista/sección visualmente vacía. Copy amable + icono.
- **Mobile-first**: siempre `flex-col lg:flex-row`, `px-4 sm:px-6`, `text-Xxl sm:text-Yxl`, `min-w-0` en children de flex, `overflow-x-auto` en rows de chips/tabs en móvil.
- **z-index stack** (no romper):
  - Sidebar drawer: `z-50` móvil / `z-40` desktop
  - Sidebar backdrop: `z-40`
  - Menu toggle: `z-60`
  - FloatingTopBar: `z-40`
  - CommandPalette / ShortcutsModal: `z-[200]+`
  - Sticky page headers: `z-40` (conviven con FloatingTopBar)

---

## Pre-commit gate (desde `frontend/`)

```bash
npx prettier --write <ficheros_tocados>
npx tsc --noEmit      # errores en src/components/ui/__tests__/*.tsx son pre-existing, ignóralos
npx next build
```

ESLint está roto a nivel repo (`@typescript-eslint/eslint-plugin` missing). No intentes arreglarlo — no es tu tarea.

---

## Trailer obligatorio en cada commit

```
<mensaje>

https://claude.ai/code/<tu_session_id>
```

Sustituye `<tu_session_id>` por el de tu sesión Claude.

---

## Pendiente (no-bloqueantes para launch, por prioridad)

1. **`/market/repos/[id]`** — no existe. Copia patrón de `/market/agents/[id]/page.tsx` (1146 líneas).
2. **Alineación de estilo `/market` con landing** — GradientText en heros que aún no lo tienen, corner brackets, glows `#836EF9`. (Agente A está en esto).
3. **Responsive pass en páginas no-market**: `/chat`, `/dm`, `/orders`, `/services`, `/notifications`, `/how-it-works`, `/reputation/leaderboard`, `/repos`.

---

## Regla de oro

Si hay duda → **commit pequeño + push inmediato**. Es mejor 5 commits de 20 líneas que 1 de 400. Así el otro agente hace pull rápido y no hay conflictos.

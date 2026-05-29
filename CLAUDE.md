# fuz_template

> SvelteKit starter template with full fuz stack integration

fuz_template (`@fuzdev/fuz_template`) is a production-ready starter template for
building static web applications with the fuz stack. Clone it to start new
projects with TypeScript, Svelte 5, SvelteKit, and the complete fuz ecosystem
pre-configured.

For coding conventions, see Skill(fuz-stack).

## Committing

`git add` and `git commit` are denied by `.claude/settings.local.json` in
this repo — make the edits and stop, the user commits.

## Gro commands

```bash
gro check     # typecheck, test, lint, format check (run before committing)
gro typecheck # typecheck only (faster iteration)
gro test      # run tests with vitest
gro gen       # regenerate .gen files (library.json, fuz.css)
gro build     # build for production (static adapter)
gro deploy    # build, commit, and push to deploy branch
gro sync      # regenerate files and run svelte-kit sync
```

IMPORTANT for AI agents: Do NOT run `gro dev` - the developer will manage the
dev server.

## Key dependencies

- Svelte 5 - component framework with runes
- SvelteKit - application framework with static adapter
- Vite - build tool
- fuz_css (@fuzdev/fuz_css) - CSS framework and design system
- fuz_ui (@fuzdev/fuz_ui) - UI components, theming, docs system
- fuz_util (@fuzdev/fuz_util) - utility functions
- fuz_code (@fuzdev/fuz_code) - syntax highlighting
- Gro (@fuzdev/gro) - build system and task runner

## Scope

fuz_template is a **SvelteKit starter template**:

- Pre-configured fuz stack (fuz_css, fuz_ui, fuz_util, fuz_code)
- Dark/light theme with persistence
- Documentation system with API generation
- Static deployment ready (GitHub Pages, Netlify)

### What fuz_template does NOT include

- Authentication or user management
- Database or backend
- Dynamic server-side content
- Production-ready components (demos only)

## Using the template

Clone with degit or use GitHub's "Use this template" button:

```bash
npx degit fuzdev/fuz_template myproject
cd myproject
npm i
```

**Files to customize:**

- `package.json` - name, version, description, homepage, repository
- `svelte.config.js` - update origin URL
- `src/routes/+layout.svelte` - update `<title>`
- `src/routes/+page.svelte` - replace demo content
- `static/CNAME` - update or delete for your domain
- `.github/FUNDING.yml` - update or delete

## Architecture

### Directory structure

```
src/
├── app.html               # HTML entry with theme detection
├── lib/                   # your library code
│   ├── Mreows.svelte      # example component (replace me)
│   └── Positioned.svelte  # example component (replace me)
└── routes/
    ├── +layout.svelte     # root layout with fuz_css imports
    ├── +layout.ts         # prerender: true, ssr: true
    ├── +page.svelte       # home page
    ├── style.css          # custom global styles
    ├── fuz.css            # generated fuz_css styles
    ├── library.gen.ts     # generates library.json
    ├── library.ts         # exports library metadata
    ├── library.json       # generated component metadata
    ├── example.test.ts    # test file example
    ├── about/+page.svelte
    └── docs/              # documentation pages
        ├── +layout.svelte # wraps docs in Docs component
        ├── +page.svelte   # docs index
        ├── tomes.ts       # documentation structure
        ├── library/       # library details page
        └── api/           # auto-generated API docs
```

### Example components (replace these)

The template includes demo components to show Svelte 5 patterns:

**Mreows.svelte** - interactive emoji grid demo showing `$props()`,
`$bindable()`, `$state()`, `$derived()`. Marked with "don't use this component".

**Positioned.svelte** - CSS transform utility with Snippet children.

Replace these with your actual components.

### SvelteKit configuration

- `+layout.ts` exports `prerender = true` and `ssr = true` for full static
  generation
- `svelte.config.js` enables runes mode and configures CSP via
  `create_csp_directives()` from fuz_ui
- Uses `@sveltejs/adapter-static` for static output

### Theme detection

`app.html` includes theme detection that runs before render:

1. Reads `localStorage.getItem('fuz:color-scheme')`
2. Falls back to `matchMedia('(prefers-color-scheme:dark)')`
3. Sets class on `<html>` element ('dark' or 'light')

This prevents flash of wrong theme on page load.

### Code generation

**library.gen.ts** - generates component library metadata:

- Outputs `library.json` (component metadata, props, dependencies) and
  `library.ts` (typed wrapper)
- Powers auto-generated API docs at `/docs/api/`

**fuz.gen.css.ts** - generates fuz_css utility classes:

- Outputs `fuz.css` with CSS custom properties and utility classes

### Documentation system

Uses fuz_ui's tome system:

- `docs/tomes.ts` - defines documentation pages
- `docs/library/` - shows `LibraryDetail` component
- `docs/api/` - auto-generated API docs from `library.json`
- `docs/api/[...module_path]/` - dynamic module documentation

## Context system

Uses contexts from fuz_ui:

- `library_context` - provides `Library` class for docs
- `tomes_context` - provides documentation structure
- Theme context via `ThemeRoot` component wrapper

## Static deployment

Pre-configured for static hosting (GitHub Pages, Netlify, etc.):

- Uses `@sveltejs/adapter-static`
- `static/CNAME` for custom domain
- `static/.nojekyll` for GitHub Pages

Deploy with `gro deploy` (builds and pushes to deploy branch).

## Known limitations

- **Demo components only** - Mreows and Positioned are examples, not for
  production use
- **Minimal test coverage** - Only one example test file included
- **Static only** - No dynamic server-side content
- **Tests colocated** - Tests in routes (`example.test.ts`) rather than
  `src/test/` directory

## Project standards

- TypeScript strict mode
- Svelte 5 with runes API
- Prettier with tabs, 100 char width
- Node >= 22.15
- Private package (not published to npm)

## Related projects

- [`fuz_css`](../fuz_css/CLAUDE.md) - CSS framework
- [`fuz_ui`](../fuz_ui/CLAUDE.md) - UI components and docs system
- [`fuz_util`](../fuz_util/CLAUDE.md) - utility functions
- [`fuz_blog`](../fuz_blog/CLAUDE.md) - extends template with blog features

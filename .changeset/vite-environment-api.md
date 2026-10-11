---
'svelte-docinfo': minor
---

**breaking:** the Vite plugin requires Vite 6 or later (now an optional `vite` peer dependency), and in dev a change reloads the page instead of sending an HMR update

The HMR update never reached the browser: it named the module by a URL the Vite client doesn't key on, so it was dropped silently, and the module's self-accept would have re-run it while importers (like a layout building a `Library` from `modules`) kept the old values anyway. The module no longer self-accepts, and when the output changes the plugin sends a full reload.

A change now also invalidates `virtual:svelte-docinfo` in every Vite environment that loaded it, not just `client` and `ssr`. The plugin uses the per-environment module graphs, hot channel, and plugin container instead of the mixed `server.moduleGraph`, `server.hot`, and `server.pluginContainer`, so it runs clean under Vite's `future.removeServerModuleGraph`/`removeServerHot`/`removeServerPluginContainer` flags. The session is now disposed in `buildEnd`, so closing a middleware-mode dev server releases it too.

When a dev server restart fails before the new server starts (for example a plugin's `configureServer` throws; Vite logs "server restart failed" and keeps the old server running) and the restart reused the plugin (plugins passed inline to `createServer`; a config file is re-evaluated, making a fresh plugin instance), the plugin now stays on the old server: before, it switched to the server that failed to start, so changes stopped reaching the running server's module graphs and browsers until the next successful restart.

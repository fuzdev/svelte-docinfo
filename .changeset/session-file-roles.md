---
'svelte-docinfo': minor
---

feat: give a session's files an explicit role, input or context

`setFile` and `setFiles` take `context: true` to ingest files as context: they feed the type checker and never emit a module, even when they're in the source scope. Without it the files are inputs, as before. The role is set on every call, so passing a file the session read on its own as context makes it an input, and passing an input with `context: true` removes its module. A change of role alone reports `changed`.

Use it when forwarding edits to files you don't mean to document, such as a watcher refreshing a dependency.

The Vite plugin does this now. In dev, only the files discovery selected emit modules: an edit to any other file refreshes it without adding a module, and when a file is created the plugin runs discovery again to decide whether it's one. Before, editing a source file that `package.json` `exports` didn't cover added it to the output until the server restarted, so dev and build could disagree.

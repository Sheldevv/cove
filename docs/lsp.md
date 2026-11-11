# Cove Language Server

Start the Language Server Protocol server over stdio:

```sh
npm run lsp
# equivalent: cove lsp
```

Implemented LSP methods:

- `initialize` / `shutdown` / `exit`
- `textDocument/didOpen`, `didChange`, `didSave`, and `didClose`
- `textDocument/publishDiagnostics` with Cove diagnostic codes and ranges
- basic keyword completion

The server currently uses full-document synchronization and recompiles the
in-memory document after each change. It does not yet provide semantic
completion, hover, go-to-definition, rename, formatting, or workspace indexing.

Editors should launch `npm run lsp` with the Cove project directory as the
working directory. A dedicated Zed/VS Code language extension and per-editor
configuration are future work; the server itself speaks standard LSP framing.

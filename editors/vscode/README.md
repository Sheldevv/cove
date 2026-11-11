# Cove Language Support for VS Code

This extension provides `.cove` file recognition, syntax highlighting, editor bracket/comment behavior, automatic Cove language-server startup, inline diagnostics, and IntelliSense completions.

## Requirements

- VS Code 1.85 or newer
- Node.js and npm
- The Cove compiler repository with its dependencies installed (`npm install`)

## Run the extension from source

1. Open this `editors/vscode` folder in VS Code.
2. Run `npm install` in this folder to install `vscode-languageclient`.
3. Choose **Run Cove Extension** in Run and Debug, then press `F5` to launch an Extension Development Host.
4. In the new VS Code window, open the Cove compiler repository root (the folder containing the root `package.json`).
5. Open an `.cove` file. The extension starts the language server automatically.

The default server command is `npm run --silent lsp`. `--silent` is important: npm's normal script banner would otherwise be written to stdout, corrupting the LSP message stream. The language server itself uses stdout exclusively for JSON-RPC messages.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `cove.server.command` | `npm` | Executable used to start the server |
| `cove.server.args` | `["run", "--silent", "lsp"]` | Arguments passed to that executable |
| `cove.server.cwd` | `""` | Working directory, relative to the first workspace folder unless absolute |

For example, if the compiler repository is not the workspace root, set `cove.server.cwd` to its relative path.

## Package as a VSIX

From this directory:

```sh
npm install
npx --yes @vscode/vsce package
code --install-extension cove-vscode-0.2.1.vsix
```

## Current language-server features

- Starts the Cove LSP automatically when a `.cove` document is opened.
- Publishes compiler diagnostics as you type.
- Completes Cove keywords with useful snippets (`fun`, `let`, `if`, `else`, `while`, `return`, etc.).
- Completes built-in types (`Int`, `String`, `Bool`, and C-style aliases).
- Suggests functions, parameters, and variables discovered in the open document.
- Uses snippet placeholders for function calls and common statement templates.
- Synchronizes full document contents with the server.

The current completion engine is document-wide rather than fully scope-aware. Hover, go-to-definition, rename, formatting, and workspace-wide module indexing are future features.

## 0.2.1 syntax highlighting

The TextMate grammar now highlights Cove's planned data-model syntax, including generic collection types (`Array<T>`, `Map<K, V>`, `vararg(T)`), array type suffixes (`T[]`), collection literals and indexing punctuation, and declarations for structs, classes, interfaces, and dynamic objects.

Syntax highlighting is editor presentation only. It does not make syntax available in the compiler before the corresponding Cove compiler milestone is implemented.

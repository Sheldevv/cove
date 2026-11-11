import { compileFrontend } from "../compiler/compile.js";
import { formatDiagnostic } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../diagnostics/source.js";

// Minimal LSP 3.17 stdio server. It intentionally keeps no filesystem or project state:
// the editor sends document contents and Cove returns diagnostics.
const documents = new Map<string, string>();
let buffer = Buffer.alloc(0);

function send(message: unknown): void {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}
function publish(uri: string, text: string): void {
  const file: SourceFile = { path: uri, text };
  const result = compileFrontend(file);
  const diagnostics = result.diagnostics.items.map((d) => ({
    range: {
      start: { line: d.span.start.line - 1, character: d.span.start.column - 1 },
      end: { line: d.span.end.line - 1, character: d.span.end.column - 1 },
    },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.code,
    source: "cove",
    message: d.help ? `${d.message}\n${d.help}` : d.message,
  }));
  send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics } });
}
function handle(message: any): void {
  const { id, method, params } = message ?? {};
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { capabilities: {
      textDocumentSync: { openClose: true, change: 1, save: { includeText: true } },
      completionProvider: { triggerCharacters: [".", ":"] },
      hoverProvider: false,
    }, serverInfo: { name: "cove-language-server", version: "0.1.0" } } });
  } else if (method === "initialized") {
    // No response required.
  } else if (method === "textDocument/didOpen") {
    const doc = params.textDocument; documents.set(doc.uri, doc.text); publish(doc.uri, doc.text);
  } else if (method === "textDocument/didChange") {
    const uri = params.textDocument.uri;
    const text = params.contentChanges.at(-1)?.text ?? documents.get(uri) ?? "";
    documents.set(uri, text); publish(uri, text);
  } else if (method === "textDocument/didSave") {
    const uri = params.textDocument.uri;
    const text = params.text ?? documents.get(uri) ?? ""; documents.set(uri, text); publish(uri, text);
  } else if (method === "textDocument/didClose") {
    const uri = params.textDocument.uri; documents.delete(uri);
    send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } });
  } else if (method === "textDocument/completion") {
    send({ jsonrpc: "2.0", id, result: { isIncomplete: false, items: ["fun", "let", "return", "if", "else", "while", "move", "unsafe"].map((label) => ({ label, kind: 14 })) } });
  } else if (method === "shutdown") send({ jsonrpc: "2.0", id, result: null });
  else if (method === "exit") process.exit(0);
  else if (id !== undefined) send({ jsonrpc: "2.0", id, result: null });
}

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const boundary = buffer.indexOf("\r\n\r\n");
    if (boundary < 0) break;
    const header = buffer.subarray(0, boundary).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) { buffer = buffer.subarray(boundary + 4); continue; }
    const length = Number(match[1]);
    const start = boundary + 4;
    if (buffer.length < start + length) break;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    try { handle(JSON.parse(body)); } catch { /* Ignore malformed editor messages; keep server alive. */ }
  }
});
process.stdin.resume();

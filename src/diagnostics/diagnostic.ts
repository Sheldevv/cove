import type { SourceFile, SourceSpan } from "./source.js";

export type DiagnosticSeverity = "error" | "warning" | "note";

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly file: SourceFile;
  readonly span: SourceSpan;
  readonly help?: string;
}

export class DiagnosticBag {
  readonly items: Diagnostic[] = [];

  error(code: string, message: string, file: SourceFile, span: SourceSpan, help?: string): void {
    this.items.push({ code, severity: "error", message, file, span, ...(help === undefined ? {} : { help }) });
  }

  warning(code: string, message: string, file: SourceFile, span: SourceSpan, help?: string): void {
    this.items.push({ code, severity: "warning", message, file, span, ...(help === undefined ? {} : { help }) });
  }

  get hasErrors(): boolean {
    return this.items.some((item) => item.severity === "error");
  }
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const { file, span } = diagnostic;
  const location = `${file.path}:${span.start.line}:${span.start.column}`;
  const header = `${location}: ${diagnostic.severity}[${diagnostic.code}]: ${diagnostic.message}`;
  const sourceLine = file.text.split(/\r?\n/)[span.start.line - 1] ?? "";
  const caretWidth = Math.max(1, span.end.line === span.start.line
    ? span.end.column - span.start.column
    : 1);
  const caret = `${" ".repeat(Math.max(0, span.start.column - 1))}${"^".repeat(caretWidth)}`;
  return [header, `  ${sourceLine}`, `  ${caret}`, ...(diagnostic.help ? [`help: ${diagnostic.help}`] : [])].join("\n");
}

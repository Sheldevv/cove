import type { SourceSpan } from "../diagnostics/source.js";
import { TokenKind } from "./token-kind.js";

export interface Token {
  readonly kind: TokenKind;
  readonly lexeme: string;
  readonly span: SourceSpan;
  readonly value?: string | number | boolean | null;
  readonly numericSuffix?: string;
}

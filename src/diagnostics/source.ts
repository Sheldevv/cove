export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export function positionAt(text: string, offset: number): SourcePosition {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;

  for (let index = 0; index < safeOffset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { offset: safeOffset, line, column };
}

export function spanFromOffsets(text: string, start: number, end: number): SourceSpan {
  return {
    start: positionAt(text, start),
    end: positionAt(text, end),
  };
}

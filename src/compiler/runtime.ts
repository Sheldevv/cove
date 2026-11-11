import type { IRModule, IRInstruction, IROperand } from "./ir.js";
import type { CoveType } from "./typed-ir.js";

/**
 * Runtime components are selected from optimized IR. Dependencies are emitted
 * once, in dependency order, and only when a reachable component is required.
 */
export type RuntimeComponent = "core.memory.process-arena" | "core.string.concat" | "core.array.bounds";

interface RuntimeComponentDefinition {
  readonly dependencies: readonly RuntimeComponent[];
  readonly cHeaders: readonly string[];
  readonly fragments: readonly string[];
}

const COMPONENTS: Record<RuntimeComponent, RuntimeComponentDefinition> = {
  "core.memory.process-arena": {
    dependencies: [],
    cHeaders: ["<stdlib.h>"],
    fragments: [
      "/* Cove's initial string arena keeps concatenation results alive until process exit. */",
      "typedef struct CoveAllocation {",
      "    void *pointer;",
      "    struct CoveAllocation *next;",
      "} CoveAllocation;",
      "static CoveAllocation *cove_allocations = NULL;",
      "static int cove_cleanup_registered = 0;",
      "static void cove_runtime_cleanup(void) {",
      "    CoveAllocation *entry = cove_allocations;",
      "    while (entry != NULL) {",
      "        CoveAllocation *next = entry->next;",
      "        free(entry->pointer);",
      "        free(entry);",
      "        entry = next;",
      "    }",
      "    cove_allocations = NULL;",
      "}",
      "static void *cove_runtime_alloc(size_t size) {",
      "    void *pointer = malloc(size);",
      "    if (pointer == NULL) abort();",
      "    CoveAllocation *entry = malloc(sizeof(*entry));",
      "    if (entry == NULL) { free(pointer); abort(); }",
      "    if (!cove_cleanup_registered) {",
      "        if (atexit(cove_runtime_cleanup) != 0) { free(entry); free(pointer); abort(); }",
      "        cove_cleanup_registered = 1;",
      "    }",
      "    entry->pointer = pointer;",
      "    entry->next = cove_allocations;",
      "    cove_allocations = entry;",
      "    return pointer;",
      "}",
    ],
  },
  "core.array.bounds": {
    dependencies: [],
    cHeaders: ["<stdio.h>", "<stdlib.h>"],
    fragments: [
      "static inline size_t cove_array_checked_index(size_t index, size_t length) {",
      "    if (index >= length) {",
      "        fprintf(stderr, \"Cove array index %zu is out of bounds (length %zu)\\n\", index, length);",
      "        abort();",
      "    }",
      "    return index;",
      "}",
    ],
  },
  "core.string.concat": {
    dependencies: ["core.memory.process-arena"],
    cHeaders: ["<string.h>"],
    fragments: [
      "static inline char *cove_concat(const char *a, const char *b) {",
      "    size_t x = strlen(a), y = strlen(b);",
      "    if (x > (size_t)-1 - y - 1) abort();",
      "    char *p = cove_runtime_alloc(x + y + 1);",
      "    memcpy(p, a, x);",
      "    memcpy(p + x, b, y + 1);",
      "    return p;",
      "}",
    ],
  },
};

export interface RuntimeRequirements {
  readonly components: readonly RuntimeComponent[];
  readonly cHeaders: readonly string[];
  readonly fragments: readonly string[];
  readonly usesPrint: boolean;
  readonly usesBool: boolean;
}

function operands(instruction: IRInstruction): IROperand[] {
  switch (instruction.op) {
    case "const": return [instruction.value];
    case "binary": return [instruction.left, instruction.right];
    case "unary": return [instruction.operand];
    case "call": return [...instruction.args];
    case "array": case "arrayview": return [...instruction.elements];
    case "arrayset": return [instruction.index, instruction.source];
    case "arraypush": return [instruction.source];
    case "arraymove": case "arraydrop": return [];
    case "index": return [instruction.array, instruction.index];
    case "arraylen": return [instruction.array];
    case "copy": return [instruction.source];
    case "phi": return instruction.incoming.map((entry) => entry.value);
    case "store": return [instruction.source];
    case "print": return [instruction.value];
    case "return": return instruction.value ? [instruction.value] : [];
    case "branch": return [instruction.condition];
    default: return [];
  }
}

function operandType(operand: IROperand): CoveType {
  return operand.kind === "value" ? operand.value.type : operand.type;
}

export function resolveRuntimeRequirements(module: IRModule): RuntimeRequirements {
  const requested = new Set<RuntimeComponent>();
  let usesPrint = false;
  let usesBool = false;

  for (const fn of module.functions) {
    if (fn.returnType === "Bool" || fn.parameters.some((parameter) => parameter.type === "Bool" || parameter.type === "Array<Bool>")) usesBool = true;
    for (const block of fn.blocks) {
      for (const instruction of block.instructions) {
        if (instruction.op === "print") usesPrint = true;
        if (instruction.op === "binary" && instruction.operator === "+" && instruction.result.type === "String") {
          requested.add("core.string.concat");
        }
        if (instruction.op === "index" && instruction.boundsCheck) requested.add("core.array.bounds");
        if ("result" in instruction && instruction.result?.type === "Bool") usesBool = true;
        if (instruction.op === "alloca" && instruction.result.type === "Bool") usesBool = true;
        if (operands(instruction).some((operand) => operandType(operand) === "Bool")) usesBool = true;
      }
    }
  }

  const ordered: RuntimeComponent[] = [];
  const visiting = new Set<RuntimeComponent>();
  const visited = new Set<RuntimeComponent>();
  const visit = (component: RuntimeComponent): void => {
    if (visited.has(component)) return;
    if (visiting.has(component)) throw new Error(`CoveSTD dependency cycle detected at '${component}'`);
    visiting.add(component);
    for (const dependency of COMPONENTS[component].dependencies) visit(dependency);
    visiting.delete(component);
    visited.add(component);
    ordered.push(component);
  };
  for (const component of requested) visit(component);

  const cHeaders = new Set<string>();
  const fragments: string[] = [];
  if (usesPrint) cHeaders.add("<stdio.h>");
  if (usesBool) cHeaders.add("<stdbool.h>");
  for (const component of ordered) {
    for (const header of COMPONENTS[component].cHeaders) cHeaders.add(header);
    fragments.push(...COMPONENTS[component].fragments);
  }

  return { components: ordered, cHeaders: [...cHeaders], fragments, usesPrint, usesBool };
}

# Cove compiler architecture

Cove is a C superset compiled through a TypeScript frontend into an explicit, typed intermediate representation, then readable C and a native executable.

```text
Cove source
  -> lexer and parser
  -> AST
  -> semantic analysis / typed program
  -> explicit IR lowering
  -> CFG analysis and SSA promotion (phi insertion)
  -> IR validation and optimization
  -> IR-only C backend
  -> GCC or Clang
  -> native executable
```

## Intermediate representation

The explicit IR uses typed virtual values and basic blocks. Control flow is represented by `branch`, `jump`, and `return` terminators. Mutable locals and parameters initially use stack slots represented by `alloca`, `load`, and `store`. The SSA pass promotes eligible local slots into immutable values and inserts `phi` nodes at dominance frontiers, including loop headers. Slots that may be read before initialization are conservatively left in memory form.

CFG analysis computes predecessors, successors, reachability, dominator sets, immediate dominators, and dominance frontiers. The SSA validator checks unique value definitions, defined uses, and dominance. The C backend lowers phi values into assignments selected by the predecessor block.

## Optimization

The current conservative optimizer performs constant folding, same-block constant propagation, local stack load forwarding, known-branch simplification, unreachable-block removal, dead pure-instruction elimination, SSA promotion, and dominator-scoped common-subexpression elimination. Calls, prints, and stores are preserved as side effects. Integer division by zero and unsafe/non-finite constant results are not folded.

The `ir` command prints the lowered IR before optimization. The `opt` command prints optimized SSA IR and a summary of the transformations. The `cfg` command prints graph edges, reachability, dominators, and SSA validation results. Native builds use the optimized IR automatically.

## Current scope

This is an actively evolving compiler prototype. The parser and semantic analyzer currently support a deliberately small language subset. Module compilation, full C interop, complete ownership checking, complete global data-flow optimization and broader SSA coverage are not implemented yet.

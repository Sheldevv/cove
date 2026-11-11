# Cove mega-test

`examples/everything.cove` is an integration test for the language subset that
exists in this compiler snapshot. It covers:

- typed and inferred local declarations;
- integer, float, double, boolean, and string values;
- arithmetic precedence, grouping, comparisons, equality, and boolean logic;
- named functions, typed parameters, inferred and explicit return types;
- `if`/`else`, nested blocks, and `while` loops;
- assignments and loop-carried values;
- string concatenation and `print`;
- shared borrowing at call sites and explicit `move` ownership transfer;
- optimization-friendly constants, branches, and SSA merge candidates.

The compiler snapshot does **not** yet parse or lower `for`/`foreach`, `loop`,
`until`, arrays, structs, enums, imports, interpolation, or full reference types.
Those are intentionally excluded rather than represented as fake passing tests.

## Run the integration test

```sh
npm install
npm run build
npm test
npm run dev -- check examples/everything.cove
npm run dev -- ir examples/everything.cove
npm run dev -- opt examples/everything.cove
npm run dev -- cfg examples/everything.cove
npm run dev -- build examples/everything.cove -o build/everything
./build/everything
```

The `build` command writes generated C to `build/generated/main.c` and invokes
GCC or Clang to produce a native executable. To inspect the C backend separately:

```sh
sed -n '1,260p' build/generated/main.c
```

## Expected-failure checks

These should fail during Cove frontend analysis, before C generation:

```sh
npm run dev -- check examples/unsafe_use_after_move.cove
npm run dev -- check examples/unsafe_borrow_conflict.cove
npm run dev -- check examples/unsafe_move_while_borrowed.cove
```

Expected diagnostic codes include `COV6001`, `COV7001`, and `COV7002`.

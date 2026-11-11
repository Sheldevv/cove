# Data model examples (design fixtures)

These snippets document the accepted Cove data-model direction. The compiler now supports the initial fixed-size array-view slice shown in `vararg-array-sum.cove`; the remaining snippets are design fixtures, not claims that their full features are implemented. The parser, semantic analyzer, IR, C backend, and CoveSTD runtime must each implement a feature before it is considered available.

## Arrays

```cove
let values: Array<Int> = [1, 2, 3];
let matrix: Int[][] = [[1, 2], [3, 4]];
values.push(4);
for (value in values) { print(value); }
```

## Ordered and unordered maps

```cove
let ordered: Map<String, Int> = ["first": 1, "second": 2];
let fast: HashMap<String, Int> = ["first": 1, "second": 2];
let maybeValue: Int? = ordered.get("first");
```

## Typed and dynamic objects

```cove
struct Point { x: Float; y: Float; }
let point = Point { x: 1.0f, y: 2.0f };

let metadata = object { name: "Cove", version: 1 };
metadata.status = "in development";
```

## JSON

```cove
import json;
let value = json.parse("{\"name\":\"Cove\"}");
let output = json.stringifyPretty(value);
```

## Executable initial array/vararg slice

Run `cove run examples/data-model/vararg-array-sum.cove` from the repository root. This example demonstrates `Array<Int>`, indexed reads, `vararg<Int>`, and postfix iteration. It does not demonstrate dynamic array growth or mutation.

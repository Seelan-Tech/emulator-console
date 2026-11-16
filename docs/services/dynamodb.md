# DynamoDB

![The query builder](../images/dynamodb-query.png#gh-light-mode-only)
![The query builder](../images/dynamodb-query-dark.png#gh-dark-mode-only)

## Tables

**DynamoDB** lists tables with their key schema and status. **Create table** asks for a name and a partition key (string, number or binary), with an optional sort key. Tables use on-demand billing. A new table shows **CREATING** for a few seconds; the emulator refuses to delete it until it is **ACTIVE**, and the console waits for you.

## Items

Open a table and choose **Items**. The grid shows items with their key attributes first. Click an item to edit it as **JSON**:

- Plain values stay plain: strings, numbers, booleans, `null`, lists and maps.
- Types JSON cannot express are tagged so that an edit round-trips exactly: `{"$ss": ["a","b"]}` is a string set, `{"$ns": ["1","2"]}` a number set, `{"$b": "<base64>"}` binary, `{"$bs": [...]}` a binary set, and `{"$n": "12345678901234567890"}` a number too large for a JavaScript number.
- Key attributes are required, and the editor tells you which one is missing.

**Schema** shows the key schema, attribute definitions and indexes.

## Query and Scan

The query builder sits above the items. It builds a `Query` or a `Scan` for you and shows exactly what it will send.

| Control                         | What it does                                                                                                                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mode**                        | `Scan` reads everything; `Query` reads one partition.                                                                                                                                                                                         |
| **Index**                       | The table itself, or any global or local secondary index. Each index has its own key schema, so the key fields change with it.                                                                                                                |
| **Partition key value**         | Required for a query. The placeholder shows the attribute name and type, and the value is converted to that type.                                                                                                                             |
| **Sort key operator and value** | `=`, `<`, `<=`, `>`, `>=`, `between` (adds an upper bound) and `begins_with`. Optional.                                                                                                                                                       |
| **Add filter**                  | Any number of filters: `=`, `≠`, `<`, `≤`, `>`, `≥`, begins with, contains, doesn't contain, exists, doesn't exist. Attribute names may be nested paths such as `address.city`, and each filter has a value type (string, number or boolean). |
| **Combine filters**             | Appears with two or more filters: all (AND) or any (OR).                                                                                                                                                                                      |
| **Descending**                  | Query only; reverses the sort-key order.                                                                                                                                                                                                      |
| **Consistent read**             | Strongly consistent read. Unavailable on a global secondary index, which is always eventually consistent.                                                                                                                                     |
| **Show request**                | The exact request as JSON, and the equivalent `aws dynamodb` command, each with a copy button.                                                                                                                                                |
| **Run** / **Reset**             | Run the query, or return to a plain scan.                                                                                                                                                                                                     |

The builder validates before it sends anything: values must match the attribute's type, and DynamoDB's rule that a query cannot filter on a key attribute is enforced with a clear message.

### Paging

Results load a page at a time with **next** and **previous**. DynamoDB applies the page size _before_ a filter, so a page of a filtered query can legitimately come back empty while more matches follow. The console keeps paging through empty pages for you instead of stopping.

### Not covered

No `IN` operator, projection expressions or parallel scan. Use the [operation runner](other-services.md) for those.

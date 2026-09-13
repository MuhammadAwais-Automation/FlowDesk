# W2 — Document store report

## FTS query sanitising

Search input is tokenised with the Unicode-aware pattern `[\p{L}\p{N}_]+`.
Every surviving token is wrapped as an FTS5 quoted phrase and the phrases are
joined with spaces, giving FTS5's implicit AND behaviour without allowing raw
input to become query syntax.

Examples:

- `yasir "bhai* OR` becomes `"yasir" "bhai" "OR"`. The unmatched quote and
  `*` are discarded, and `OR` is a literal quoted token rather than an operator.
- `client-name` becomes `"client" "name"`; `-` cannot become an FTS operator.
- `title:value` becomes `"title" "value"`; `:` cannot select an FTS column.
- `foo^bar` becomes `"foo" "bar"`; `^` cannot affect the expression.
- `NEAR launch` becomes `"NEAR" "launch"`; `NEAR` is treated literally.
- `  " * : - ^  ` contains no tokens and returns `[]` before SQLite is called.

This also prevents raw quotes from producing malformed MATCH expressions.

## BM25 normalisation

SQLite FTS5 ranks the best result with the lowest (normally negative) `bm25`
value. Search orders by raw `bm25(knowledge_fts)` ascending, then exposes
`-bm25(knowledge_fts)` as `score`. The public score is therefore positive and
a better match has a higher score than a worse match.

## Transaction boundaries

Every `upsert` starts `BEGIN IMMEDIATE`. The existing-row/hash check, document
insert or update, FTS delete/insert, and wholesale link delete/insert all occur
inside that transaction. An unchanged hash commits without modifying any row.
Successful changed writes commit only after the final document row has been
read back; any exception rolls the transaction back. The invalid-scope
regression test confirms a foreign-key failure leaves the document, FTS, and
link tables unchanged.

Links are deduplicated before insertion. A target is marked resolved only when
an active document with the same path exists in the same scope; no placeholder
document is created.

## FTS as the body store

Reading the body from `knowledge_fts.body` proved workable. `read` joins the
active, scope-filtered document row to its FTS row and returns that stored body
without consulting the filesystem. Changed-hash upserts replace the FTS row in
the same transaction, so reads cannot observe document metadata and body from
different revisions.

## Specification notes

No incorrect requirement was found. The implementation adds deterministic
path ordering after the required type and descending update-time keys so ties
remain stable, and clamps negative limits to zero in addition to enforcing the
specified maximums.

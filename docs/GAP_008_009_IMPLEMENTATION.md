# GAP-008 / GAP-009 local implementation slice

Scope: warping outputs and sizing recipe revisions. No production access, commit,
push, package changes, seed changes, or edits to the parent workflow test.

## API and UI behavior

- `POST /warping/:id/release` accepts `nextStage: SIZING | WEAVING` and freezes it
  in both the issued warp card and execution snapshot. The panel requires an
  explicit route selection before issuing. This is an approval at card issue;
  it is not automatic inference from an Excel/specification field.
- Existing callers may still release without a route. Their `/complete` request
  must supply an explicit route; no unchecked weaving default remains. This
  compatibility path is marked `legacyRoute` in the completion event. A frozen
  card route cannot be overridden by the completion request.
- `POST /warping/:id/complete` keeps the existing request fields and default
  final-close behavior. `closeOrder: false` records one additional beam and keeps
  the order `IN_PROGRESS`. `actualLengthM` means this beam's length; the order
  total accumulates recorded lengths, including rejected output. Rejected beams
  remain traceable with `REJECTED` status. Each beam has independent quality,
  length and barcode. The first beam retains the original card barcode and any
  supplied custom beam number. Later beams receive unique barcodes and suffixes.
- The order row lock and version check serialize output recording. A stale or
  concurrent request cannot create a second output for the same version.
- `GET/POST /sizing/recipes` list/create company-scoped recipe revisions.
  Reusing a code creates a new draft revision under an advisory transaction lock.
  `POST /sizing/recipes/:recipeId/approve` approves a draft. These actions reuse
  existing sizing view/manage permissions; revisions have no edit/delete API.
- Sizing creation optionally accepts `recipeRevisionId`. It must identify an
  approved revision in the same company. Its contents are copied into the order's
  existing `recipe` field. Optional recipe overrides require
  `recipeDeviationReason`; the reference and reason are saved separately.
  Legacy inline recipes remain supported. Recipe creation, approval and selection
  are available in the sizing panel; override entry is currently API-only.
- Apply migration `099_manufacturing_sizing_recipes.sql` before using these
  routes. It adds the recipe revision library and company-scoped order reference;
  it does not rewrite historical recipes.

## Validation

Passed locally: manufacturing reference tests, server TypeScript check, frontend
TypeScript check, Vite build, isolated PostgreSQL migration test, existing parent
workflow HTTP integration test, and the new
`manufacturingWarpingSizing.integration.test.ts`.

The new test covers 400m + 600m outputs, frozen route enforcement, stale versions,
concurrent final output requests, distinct barcodes, draft recipe rejection,
version snapshots, deviation reasons, company isolation, permissions, duplicate
active sizing protection and rejected-beam rejection. Tests opt in through the
existing local-only database guard and use a fresh schema. No visual browser QA
was performed for this slice.

## Explicit remainder: neither gap is fully closed

- Warping: separate proposed returns from warehouse receipt; discrepancy approval
  and closure guards; package/recipient custody details and yarn suggestions;
  beam allocations, locations and handover movements; repair/reinspection;
  multiworker/daily records; selvage exceptions; authorized route exceptions and
  broader barcode/label workflow. Existing yarn settlement behavior is unchanged.
- Sizing: non-yarn consumable stock and shared issue/return service; warehouse
  custody and actual consumption settlement; downtime and multiworker records;
  treatment/reinspection and held conditional output; additional label/scan flows.
  Existing `CONDITIONAL` handling is unchanged and still requires follow-up.
- Recipe revisions currently have draft/approved states only; retirement and
  specialized approval permissions are not implemented. Manual legacy recipes
  remain intentionally available for compatibility.
- No automatic shortfall/overproduction tolerance or unapproved business rule
  was introduced. The caller explicitly chooses when to close the order.

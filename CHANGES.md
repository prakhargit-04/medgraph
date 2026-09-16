# Fixes applied in this pass

Based on the code-level review. Items are grouped by the review's own priority markers.

## 🔴 Critical

1. **Single pipeline.** `page.tsx` no longer re-implements normalize → label → extract
   client-side. Both live and demo mode now call `POST /api/analyze` exclusively, so
   there is exactly one implementation of the analysis pipeline, not two that can drift
   apart. The old per-stage progress UI (`normalizing/retrieving/extracting` counters)
   was replaced with a single spinner, since that bookkeeping no longer exists client-side.

2. **Graph-status bug.** `buildGraph()` in `/api/analyze` (the only place this logic now
   lives) previously marked a pair `no_evidence` if *either* drug's label was found,
   even if the other drug's label was never actually checked. Fixed to require **both**
   labels found (and no extraction failure) before calling it a determinate "no evidence".

3. **False "completed" status.** Added a third `analysisStatus`: `'unresolved'`, used when
   no extraction was ever attempted (e.g. no medication resolved to a usable label). The
   UI now shows a distinct banner for this case instead of silently calling it "completed".

## 🟠 Important

4. **Shared library, not route-importing-route.** Moved extraction/validation, RxNorm
   normalization, and openFDA label retrieval into `src/lib/extraction.ts`,
   `src/lib/normalization.ts`, and `src/lib/labeling.ts`. `/api/normalize`, `/api/label`,
   `/api/extract`, and `/api/analyze` are now thin HTTP wrappers around these shared
   modules instead of duplicating logic or importing from each other's route files.
5. **Gemini schema validation.** Added `getRelationshipShapeError()` in
   `lib/extraction.ts` — rejects any relationship object from Gemini that isn't a plain
   object with the expected string-typed fields, before it reaches quote validation.
6. **Consistent medication cap.** `MAX_MEDS` (frontend) and `MAX_MEDICATIONS` (backend)
   are both `5` now.
7. **Case-insensitive duplicate detection.** `groupByGenericName()` groups by a
   lowercased key so capitalization differences can't hide a duplicate active ingredient.
9. **Wording.** Prompt and UI copy now consistently say "FDA-submitted drug labeling
   retrieved through openFDA" instead of implying openFDA independently verifies labels.
10. **Logging.** Removed the raw full-text Gemini output log; now logs model + response
    length only.

## 🟡 Presentation accuracy

13. "FDA Label Evidence" → "Source Evidence" in the Evidence Inspector.
15. Removed the "🔄 Retry" action-style label from graph edges (the graph now
    communicates state only; retry belongs in the inspector, not the edge label).
16. "Clinical OS" → "Medication Safety Intelligence".
17. "FDA DailyMed Synced • Live" → "Live Evidence Source • openFDA" (accurate to what's
    actually being queried).
18. Removed the non-functional "Quick search ⌘K" button.
19. Removed the decorative "DR" avatar (no auth/profile system exists).
- Added a proper `unavailable`-status banner in the Evidence Inspector (previously
  unhandled — only `signal`, `extraction_failed`, and `no_evidence` had banners).

## Verified

- `npx tsc --noEmit` — clean.
- `npx next build` — succeeds.

## Not done in this pass

- Turning `test-states.js` / `test-e2e.js` into real pass/fail assertions (item 22/23).
  These are manual debug scripts hitting live external APIs (RxNorm, openFDA, Gemini)
  and weren't runnable in this sandboxed environment, so they were left as-is rather
  than edited blind.
- Visual/animation polish for the Evidence Inspector and Graph (items 12, 14) — the
  original review explicitly flagged these as later-stage refinement, not correctness
  work.

# Browser verification

Verified October 10, 2026 against the local production entry point at port 4174 using the Codex in-app browser.

## Observed behavior

- All nine guided screens open. Back, Next, Pause and Step control the sequences.
- Construction starts with zero visible facts and finishes at 4,418 nodes, 3,488 edges and 600 notes. Final source-read counters are checked by automated engine tests.
- Search k=5 shows 1 correct and 4 incorrect unique patients; k=20 shows 7 correct and 12 incorrect unique patients. The underlying ranking is also independently tested.
- Reader screen shows the complete bedside note, author, date, evidence and measured precision/recall. Both a real false positive and a missed sentence open their source note.
- The main investigation shows the prepared ontology route, then the actual patient path. Coded social needs returns zero rows, displays neighboring source rows, and continues into P0001-N01 with its actual span and reader output.
- Hospital-unit question returns 32 detected patients across three units; this differs from the main follow-up cohort and is presented with its own question. The separate labeled truth is shown in comparison.
- Free-text insulin-cost wording selects the prepared cost question. A visible notice identifies this as a closest prepared question.
- Patient P0009 has cost and transportation needs. Resolving cost changes the primary action to transportation and the cost-query count from 11 to 10. Reset restores the original graph.
- Rewind to discharge day shows day 0, the earlier bedside note and 14 facts; returning to today shows day 14 and the open gap. Future timeline details are withheld until their date.
- Monday work lists retain the standard-call group and separate the patients outside the 30-day window.
- Source dialogs, the evaluation table, query inspector, hospital tables and note-reader console open with actual content.

## Screen sizes

| Viewport | Check |
|---|---|
| 1440 × 900 | Graph, patient narrative and engine console visible together; console ends above the fixed navigation footer. |
| 1280 × 900 | No page-level horizontal overflow; bounded graph and independent panel scrolling. |
| 1920 × 1080 | Graph and narrative expand while the engine remains visible. |
| 390 × 844 | Menu replaces sidebar; fixed Next/Back controls; engine opens as a bottom sheet. Measured visible controls have at least 44px height. Pipeline text is 13px and scrolls within the sheet. Page width remains within the viewport. |

Graph cards use 13px labels on desktop and 11px labels on mobile, with full labels and evidence available on selection. Dense mobile graphs scroll vertically inside their panel. Short desktop windows use page scrolling to avoid clipping the graph. Reduced-motion CSS disables animation; this setting was code-reviewed, not emulated in the browser.

## Verification boundaries

111 automated tests passed, including 20 tests for the new prototype and 91 retained regressions for the earlier integration modules. The bundled Worker check verifies every served asset and confirms retired external-service APIs return a disabled response. These checks validate this synthetic demonstration, not hospital operations or clinical outcomes.

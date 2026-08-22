import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPublicationPagePreparationGate,
  assertPublicationTraceComplete,
  PUBLICATION_PAGE_PREPARATION_ATTRIBUTION,
  PUBLICATION_PAGE_PREPARATION_MAX_TASK_MS,
  PUBLICATION_TRACE_START_CONFIG,
} from "../scripts/publication-trace-policy.js";

test("publication tracing records as much as possible with the bounded category set", () => {
  assert.deepEqual(PUBLICATION_TRACE_START_CONFIG, {
    transferMode: "ReportEvents",
    traceConfig: {
      recordMode: "recordAsMuchAsPossible",
      includedCategories: [
        "blink.user_timing",
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
      ],
    },
  });
});

test("publication trace completion rejects reported or unknown data loss", () => {
  assert.doesNotThrow(() => assertPublicationTraceComplete({ dataLossOccurred: false }));
  for (const completion of [{ dataLossOccurred: true }, {}, null]) {
    assert.throws(() => assertPublicationTraceComplete(completion), (error) => error?.code === "PUBLICATION_TRACE_DATA_LOSS");
  }
});

test("publication page-preparation gate requires positive attribution and retains 50 ms", () => {
  const passing = {
    pagePreparation: {
      attribution: PUBLICATION_PAGE_PREPARATION_ATTRIBUTION,
      idleCallbackCount: 2,
      taskCount: 2,
      maxTaskMs: PUBLICATION_PAGE_PREPARATION_MAX_TASK_MS,
    },
  };
  assert.doesNotThrow(() => assertPublicationPagePreparationGate(passing));
  for (const pagePreparation of [
    { ...passing.pagePreparation, idleCallbackCount: 0 },
    { ...passing.pagePreparation, taskCount: 0 },
    { ...passing.pagePreparation, attribution: "unattributed" },
  ]) {
    assert.throws(() => assertPublicationPagePreparationGate({ pagePreparation }), (error) => error?.code === "PAGE_PREPARATION_ATTRIBUTION_MISSING");
  }
  assert.throws(
    () => assertPublicationPagePreparationGate({ pagePreparation: { ...passing.pagePreparation, maxTaskMs: PUBLICATION_PAGE_PREPARATION_MAX_TASK_MS + 0.001 } }),
    (error) => error?.code === "PAGE_PREPARATION_LONG_TASK",
  );
});

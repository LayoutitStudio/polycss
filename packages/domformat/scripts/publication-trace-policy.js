import { invariant } from "../src/errors.js";

export const PUBLICATION_PAGE_PREPARATION_MAX_TASK_MS = 50;
export const PUBLICATION_PAGE_PREPARATION_ATTRIBUTION = "RunTask containing FireIdleCallback";
export const PUBLICATION_TRACE_START_CONFIG = Object.freeze({
  transferMode: "ReportEvents",
  traceConfig: Object.freeze({
    recordMode: "recordAsMuchAsPossible",
    includedCategories: Object.freeze([
      "blink.user_timing",
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
    ]),
  }),
});

export function assertPublicationTraceComplete(completion) {
  invariant(completion?.dataLossOccurred === false, "PUBLICATION_TRACE_DATA_LOSS", "Chrome reported data loss in the publication trace.");
}

export function assertPublicationPagePreparationGate(trace) {
  const preparation = trace?.pagePreparation;
  invariant(
    preparation?.attribution === PUBLICATION_PAGE_PREPARATION_ATTRIBUTION
      && preparation.idleCallbackCount > 0
      && preparation.taskCount > 0,
    "PAGE_PREPARATION_ATTRIBUTION_MISSING",
    "Publication trace contains no attributable page-preparation task; the 50 ms gate cannot pass vacuously.",
  );
  invariant(
    preparation.maxTaskMs <= PUBLICATION_PAGE_PREPARATION_MAX_TASK_MS,
    "PAGE_PREPARATION_LONG_TASK",
    `Publication trace page preparation reached ${preparation.maxTaskMs} ms, above ${PUBLICATION_PAGE_PREPARATION_MAX_TASK_MS} ms.`,
  );
}

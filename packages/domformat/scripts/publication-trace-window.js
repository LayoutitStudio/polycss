import { invariant } from "../src/errors.js";

export function publicationFrameAdvances(startFrame, endFrame, frameCount) {
  invariant(startFrame >= 1 && startFrame <= frameCount && endFrame >= 1 && endFrame <= frameCount, "PUBLICATION_DIAGNOSTIC_WINDOW", "Publication diagnostic window contains an invalid frame.");
  return endFrame >= startFrame ? endFrame - startFrame : frameCount - startFrame + endFrame;
}

export function publicationPageBoundariesCrossed(startFrame, endFrame, frameCount, framesPerPage) {
  invariant(frameCount % framesPerPage === 0, "PUBLICATION_DIAGNOSTIC_WINDOW", "Publication diagnostic pages do not divide the frame cycle.");
  const advances = publicationFrameAdvances(startFrame, endFrame, frameCount);
  if (advances === 0) return 0;
  const startPage = Math.floor((startFrame - 1) / framesPerPage);
  const endPage = Math.floor((endFrame - 1) / framesPerPage);
  return endFrame >= startFrame ? endPage - startPage : frameCount / framesPerPage - startPage + endPage;
}

export function assertSingleCycleTraceDuration(durationMs, frameCount, tickRateHz) {
  invariant(Number.isFinite(durationMs) && durationMs >= 40_000, "PUBLICATION_TRACE_DURATION", "The publication trace must run for at least 40 seconds.");
  invariant(durationMs <= frameCount / tickRateHz * 1_000 - 3_000, "PUBLICATION_TRACE_DURATION", "The publication trace must retain three seconds of headroom before one prepared playback cycle so frame-window evidence is unambiguous.");
}

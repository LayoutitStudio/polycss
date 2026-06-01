/**
 * Receiver-shadow face grouping. Pure geometry, now living in core so React
 * and Vue can share the algorithm. This file re-exports the core helpers so
 * the rest of the vanilla scene code keeps its existing import path.
 */
export {
  expandConvexHullOutward,
  groupReceiverFaceGroups,
  meshScaleVec3,
  RECEIVER_NORMAL_TOL,
  RECEIVER_OFFSET_TOL,
  RECEIVER_OUTLINE_EXPAND,
  worldCssForMesh,
} from "@layoutit/polycss-core";
export type { ReceiverPlaneGroup } from "@layoutit/polycss-core";

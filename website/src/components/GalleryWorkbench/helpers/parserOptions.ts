import type { ObjParseOptions, GltfParseOptions, VoxParseOptions, StlParseOptions } from "@layoutit/polycss";
import type { ParserOptionsState } from "../types";

export function mergeParserOptions(
  base: ObjParseOptions | GltfParseOptions | VoxParseOptions | StlParseOptions | undefined,
  parser: ParserOptionsState,
): ObjParseOptions & GltfParseOptions & VoxParseOptions & StlParseOptions {
  return {
    ...(base ?? {}),
    targetSize: parser.targetSize,
    defaultColor: parser.defaultColor,
  };
}

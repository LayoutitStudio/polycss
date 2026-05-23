import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GUI } from "lil-gui";

import {
  InspectorContent,
  type InspectorColorChangeHandler,
  type InspectorMesh,
} from "../../Inspector";
import { useFolder } from "../primitives";

export interface MaterialsFolderInputs {
  meshes: InspectorMesh[];
  onColorChange: InspectorColorChangeHandler;
}

export function useMaterialsFolder(parent: GUI | null, inputs: MaterialsFolderInputs): ReactNode {
  const folder = useFolder(parent, "Materials");
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!folder) return;
    const children = (folder as unknown as { $children: HTMLElement }).$children;
    const div = children.ownerDocument.createElement("div");
    div.className = "dn-materials-folder-content";
    children.appendChild(div);
    setPortalEl(div);
    return () => {
      div.remove();
      setPortalEl(null);
    };
  }, [folder]);

  return portalEl
    ? createPortal(
      <InspectorContent
        meshes={inputs.meshes}
        onColorChange={inputs.onColorChange}
        className="dn-materials-folder dark-scrollbar"
        emptyText="No materials"
        layout="palette"
      />,
      portalEl,
    )
    : null;
}

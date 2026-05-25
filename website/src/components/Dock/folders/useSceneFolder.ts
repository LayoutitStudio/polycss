/**
 * Scene folder for the Dock: builder-only outliner.
 *
 * Hosts a React portal mount point inside a real lil-gui "Scene" folder.
 * The builder uses it for its placed-items list.
 *
 * The portal target is held in React state; the returned ReactNode is a
 * `createPortal(content, portalEl)` the caller must render somewhere in its
 * tree so React drives the children inside the lil-gui DOM.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GUI } from "lil-gui";

import { useFolder } from "../primitives";

export interface SceneFolderInputs {
  /** React content rendered into a portal inside the Scene folder body
   *  The builder uses this for its items list. */
  content: ReactNode;
}

/** Returns a JSX element you must include in the render output. Internally
 *  it's a `createPortal(content, portalEl)` — the hook owns the portal
 *  target and renders the React content into the lil-gui folder body. */
export function useSceneFolder(parent: GUI | null, inputs: SceneFolderInputs): ReactNode {
  const folder = useFolder(parent, "Scene");
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!folder) return;
    const children = (folder as unknown as { $children: HTMLElement }).$children;
    const div = children.ownerDocument.createElement("div");
    div.className = "dn-scene-folder-content";
    children.appendChild(div);
    setPortalEl(div);
    return () => {
      div.remove();
      setPortalEl(null);
    };
  }, [folder]);

  return portalEl ? createPortal(inputs.content, portalEl) : null;
}

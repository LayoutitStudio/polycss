import { PolyMorphRenderError } from "./renderError.js";
import type {
  PolyMorphPreparedDomTarget,
  PolyMorphPreparedDomTargetInput,
  PolyMorphPreparedElementTarget,
} from "./types.js";

function fail(code: string, path: string, message: string): never {
  throw new PolyMorphRenderError(code, path, message);
}

function element(value: unknown, path: string): HTMLElement {
  const target = value as HTMLElement | null;
  if (
    !target
    || typeof target !== "object"
    || !target.ownerDocument
    || typeof target.style?.setProperty !== "function"
  ) {
    fail("invalid-target", path, "expected an HTMLElement");
  }
  return target;
}

function transform(value: unknown, path: string): string {
  if (typeof value !== "string") {
    fail("invalid-transform", path, "expected a CSS transform string");
  }
  return value;
}

function createElementTarget(
  targetElement: HTMLElement,
  path: string,
  assertAlive: () => void,
): PolyMorphPreparedElementTarget {
  let requestedTransform: string | undefined;
  let requestedVisibility: boolean | undefined;
  let requestedOpacity: number | undefined;
  let requestedImagePositionY: string | undefined;
  return Object.freeze({
    element: targetElement,
    writeTransform(value: string): boolean {
      assertAlive();
      const next = transform(value, `${path}.transform`);
      if (requestedTransform === next) return false;
      targetElement.style.transform = next;
      requestedTransform = next;
      return true;
    },
    writeVisibility(visible: boolean): boolean {
      assertAlive();
      if (typeof visible !== "boolean") {
        fail("invalid-visibility", `${path}.visible`, "expected a boolean");
      }
      if (requestedVisibility === visible) return false;
      targetElement.style.visibility = visible ? "visible" : "hidden";
      requestedVisibility = visible;
      return true;
    },
    writeOpacity(opacity: number): boolean {
      assertAlive();
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
        fail("invalid-opacity", `${path}.opacity`, "expected a value in [0, 1]");
      }
      if (requestedOpacity === opacity) return false;
      targetElement.style.opacity = String(opacity);
      requestedOpacity = opacity;
      return true;
    },
    writeImagePositionY(position: string): boolean {
      assertAlive();
      if (typeof position !== "string" || position.length === 0) {
        fail("invalid-image-position", `${path}.imagePositionY`, "expected a CSS position");
      }
      if (requestedImagePositionY === position) return false;
      targetElement.style.backgroundPositionY = position;
      requestedImagePositionY = position;
      return true;
    },
  });
}

export function createPolyMorphPreparedDomTarget(
  input: PolyMorphPreparedDomTargetInput,
): PolyMorphPreparedDomTarget {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("invalid-target", "$", "expected a prepared DOM target");
  }
  const modelElement = element(input.model?.element, "$.model.element");
  if (typeof input.model?.writeTransform !== "function") {
    fail("invalid-target", "$.model.writeTransform", "expected a transform writer");
  }
  if (!Array.isArray(input.shapes) || !Array.isArray(input.leaves)) {
    fail("invalid-target", "$", "expected shape and leaf target arrays");
  }
  const shapeElements = input.shapes.map((target, index) =>
    element(target?.element, `$.shapes[${index}].element`));
  const leafElements = input.leaves.map((target, index) =>
    element(target?.element, `$.leaves[${index}].element`));
  const modelParent = modelElement.parentNode;
  const shapeParents = shapeElements.map((target) => target.parentNode);
  const leafParents = leafElements.map((target) => target.parentNode);
  let destroyed = false;
  const assertAlive = (): void => {
    if (destroyed) fail("target-destroyed", "$", "prepared DOM target is destroyed");
  };
  const shapes = Object.freeze(shapeElements.map(
    (target, index) => createElementTarget(target, `$.shapes[${index}]`, assertAlive),
  ));
  const leaves = Object.freeze(leafElements.map(
    (target, index) => createElementTarget(target, `$.leaves[${index}]`, assertAlive),
  ));
  let requestedModelTransform: string | undefined;
  const model = Object.freeze({
    element: modelElement,
    writeTransform(value: string): boolean {
      assertAlive();
      const next = transform(value, "$.model.transform");
      if (requestedModelTransform === next) return false;
      const changed = input.model.writeTransform(next);
      if (typeof changed !== "boolean") {
        fail("invalid-writer-result", "$.model.writeTransform", "expected a boolean");
      }
      requestedModelTransform = next;
      return changed;
    },
  });
  const assertStableDomIdentity = (): void => {
    assertAlive();
    const drifted = modelElement.parentNode !== modelParent
      || shapes.some((target, index) => target.element.parentNode !== shapeParents[index])
      || leaves.some((target, index) => target.element.parentNode !== leafParents[index]);
    if (drifted) {
      fail("identity-drift", "$", "retained DOM identity changed after adoption");
    }
  };
  return Object.freeze({
    model,
    shapes,
    leaves,
    get destroyed(): boolean {
      return destroyed;
    },
    assertStableDomIdentity,
    destroy(): void {
      destroyed = true;
    },
  });
}

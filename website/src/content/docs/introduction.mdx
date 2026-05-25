---
title: Introduction
description: "PolyCSS is a CSS polygon-mesh renderer: DOM-native 3D without WebGL."
---

import { Tabs, TabItem } from '@astrojs/starlight/components';

**PolyCSS** renders 3D meshes in the DOM. No WebGL, no canvas-as-scene: the rendered output is a tree of standard DOM elements positioned with `transform: matrix3d(...)`. Each visible polygon becomes one leaf DOM node you can inspect in DevTools, target with CSS, or attach events to.

Internally, the renderer chooses the cheapest CSS strategy per polygon. Solid rectangles, stable quads, triangles, and clipped solids can render as CSS primitives; textured polygons and unsupported shapes fall back to generated atlas slices. Atlas rasterization happens once at mount, then camera, mesh, and light updates flow through CSS transforms and custom properties.

## Framework Support

PolyCSS is **vanilla-first**. The default entry point is custom elements (`<poly-camera>`, `<poly-scene>`, `<poly-mesh>`, `<poly-polygon>`, controls, helpers, and shapes) plus imperative APIs such as `createPolyCamera`, `createPolyScene`, and `createPolyOrbitControls`: no framework required. First-class bindings for **React** and **Vue** ship as separate packages on top of the same engine. Pick whatever fits your stack.

## Installation

<Tabs syncKey="pkg">
<TabItem label="Vanilla JS">
```bash
npm install @layoutit/polycss
```
</TabItem>
<TabItem label="React">
```bash
npm install @layoutit/polycss-react
```
</TabItem>
<TabItem label="Vue">
```bash
npm install @layoutit/polycss-vue
```
</TabItem>
</Tabs>

### CDN (custom elements)

You can also load PolyCSS directly from a CDN with no build step:

```html
<script type="module" src="https://esm.sh/@layoutit/polycss/elements"></script>
```

## A quick taste

Render a 3D shape with zero JS: just custom elements:

```html
<script type="module" src="https://esm.sh/@layoutit/polycss/elements"></script>

<poly-camera rot-x="65" rot-y="45">
  <poly-scene>
    <poly-icosahedron size="100" color="#ff6644"></poly-icosahedron>
  </poly-scene>
</poly-camera>
```

Or with React:

```tsx
import { PolyCamera, PolyScene, PolyIcosahedron } from "@layoutit/polycss-react";

export function App() {
  return (
    <PolyCamera rotX={65} rotY={45}>
      <PolyScene>
        <PolyIcosahedron size={100} color="#ff6644" />
      </PolyScene>
    </PolyCamera>
  );
}
```

Continue to **[Quickstart →](/quickstart)** for the full walkthrough with Vanilla JS, React, and Vue versions.

## Related

- [Quickstart](/quickstart): Full install + first scene walkthrough.
- [Core Concepts](/core-concepts): The mental model: PolyScene, PolyMesh, Poly, polygon data, pipeline.
- [PolyCamera](/components/poly-camera): Camera component reference.
- [PolyScene](/components/poly-scene): Scene component reference.

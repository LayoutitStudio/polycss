# Changelog

## 0.0.1

- Prepare deterministic, content-addressed retained models from glTF and GLB
  sources through the Node-only entry.
- Load and mount prepared models through the browser-safe entry with stable leaf
  identity and caller-owned timing.
- Support static models, sparse morph regions, controls, springs, animation,
  joint skinning, and prepared playback.
- Use native CSS triangle primitives where available and prepared,
  polygon-sized alpha-atlas slices elsewhere, with no runtime rasterization.

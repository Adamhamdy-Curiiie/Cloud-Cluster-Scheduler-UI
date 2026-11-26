`three.bundle.js` bundles Three.js, OrbitControls, GLTFLoader, and SkeletonUtils
for offline use. No scripts, models, textures, or decoders are fetched from a CDN.
The UI loads the generated bundle directly on startup.
Run `npm run build:3d` in `ui` after installing dependencies in a fresh checkout and again after changing the dependency or entry point.
Three.js is MIT licensed; see `THREE-LICENSE.txt`.

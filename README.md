# soul-mirror

Browser demo: webcam feeds MediaPipe, which returns 468 face landmarks, and they are rendered as a point cloud in Three.js. Mirrored on X so it behaves like an actual mirror.

## What's in it

- Webcam capture via `getUserMedia`.
- Face detection — MediaPipe Tasks Vision (`FaceLandmarker`, VIDEO mode, GPU delegate). Model `face_landmarker.task` lives in `public/models/`, wasm in `public/mediapipe-wasm/`.
- Landmark smoothing via moving average (3-frame window).
- Three.js scene: camera, OrbitControls, ambient light, grid helper for spatial reference.
- Postprocessing: `EffectComposer` → `RenderPass` → `UnrealBloomPass` → `OutputPass`, ACES tone mapping, half-float render target.
- Landmarks drawn as `THREE.Points` with additive blending.
- Mirrored video preview in the corner, status overlay, button / F key to toggle fullscreen.
- stats.js FPS panel, ResizeObserver for canvas resize, HMR cleanup.

## Stack

- TypeScript + Vite
- three ^0.184 (+ OrbitControls, EffectComposer, UnrealBloomPass)
- @mediapipe/tasks-vision ^0.10
- stats.js, lil-gui

## Run

```
npm install
npm run dev
```

Build: `npm run build`. Preview built output: `npm run preview`.

The model and wasm must be at `public/models/face_landmarker.task` and `public/mediapipe-wasm/` respectively, otherwise `FaceTracker.init()` will fail.

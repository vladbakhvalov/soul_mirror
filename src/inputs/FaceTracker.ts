import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import * as THREE from 'three';

export const NUM_LANDMARKS = 468;

export interface FaceTrackerOptions {
  video: HTMLVideoElement;
  modelUrl?: string;
  wasmBaseUrl?: string;
  smoothing?: number; // moving-average window size, >=1
  delegate?: 'GPU' | 'CPU';
}

export interface FaceFrame {
  /** 468 * 3 floats in mirrored, centered, unit-scaled space (Three.js axes). */
  landmarks: Float32Array;
  /** blendshape category name → score (0..1). */
  blendshapes: Map<string, number>;
  /** Head pose matrix, or null if not available this frame. */
  transform: THREE.Matrix4 | null;
  /** True if a face was detected in the latest update. */
  hasFace: boolean;
  /** performance.now() timestamp of the frame the result was produced from. */
  timestamp: number;
}

/**
 * Wraps MediaPipe FaceLandmarker. Call `init()`, then `update()` from your RAF.
 * Reads from the provided <video> element (which must already have a stream).
 */
export class FaceTracker {
  private readonly opts: Required<FaceTrackerOptions>;
  private landmarker: FaceLandmarker | null = null;
  private lastVideoTime = -1;
  private readonly rawScratch = new Float32Array(NUM_LANDMARKS * 3);
  private readonly history: Float32Array[] = [];
  private historyHead = 0;
  private readonly transformMat = new THREE.Matrix4();

  readonly frame: FaceFrame = {
    landmarks: new Float32Array(NUM_LANDMARKS * 3),
    blendshapes: new Map(),
    transform: null,
    hasFace: false,
    timestamp: 0,
  };

  constructor(opts: FaceTrackerOptions) {
    this.opts = {
      video: opts.video,
      modelUrl: opts.modelUrl ?? '/models/face_landmarker.task',
      wasmBaseUrl: opts.wasmBaseUrl ?? '/mediapipe-wasm',
      smoothing: Math.max(1, opts.smoothing ?? 3),
      delegate: opts.delegate ?? 'GPU',
    };
    for (let i = 0; i < this.opts.smoothing; i++) {
      this.history.push(new Float32Array(NUM_LANDMARKS * 3));
    }
  }

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(this.opts.wasmBaseUrl);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: this.opts.modelUrl,
        delegate: this.opts.delegate,
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  }

  /** Run detection on the latest video frame. Safe to call every RAF. */
  update(now = performance.now()): boolean {
    const lm = this.landmarker;
    const video = this.opts.video;
    if (!lm || video.readyState < 2) return false;

    const t = video.currentTime;
    if (t === this.lastVideoTime) return false;
    this.lastVideoTime = t;

    const result = lm.detectForVideo(video, now);
    this.applyResult(result, now);
    return true;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }

  private applyResult(result: FaceLandmarkerResult, now: number): void {
    this.frame.timestamp = now;
    const faces = result.faceLandmarks;
    if (!faces || faces.length === 0) {
      this.frame.hasFace = false;
      this.frame.transform = null;
      return;
    }

    const lms = faces[0];
    // 1. Pack raw into scratch with mirror(x) + flip(y).
    //    MediaPipe x,y in [0,1] image space; z in same scale as x, head-centered-ish.
    const raw = this.rawScratch;
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let i = 0; i < NUM_LANDMARKS; i++) {
      const p = lms[i];
      const x = 1.0 - p.x; // mirror (selfie view)
      const y = -p.y; // flip Y (image down → world up)
      const z = -p.z; // in front of camera = +Z in our space
      raw[i * 3] = x;
      raw[i * 3 + 1] = y;
      raw[i * 3 + 2] = z;
      cx += x;
      cy += y;
      cz += z;
    }
    cx /= NUM_LANDMARKS;
    cy /= NUM_LANDMARKS;
    cz /= NUM_LANDMARKS;

    // 2. Compute scale from a stable feature: distance forehead(10) ↔ chin(152).
    const ax = raw[10 * 3] - raw[152 * 3];
    const ay = raw[10 * 3 + 1] - raw[152 * 3 + 1];
    const az = raw[10 * 3 + 2] - raw[152 * 3 + 2];
    const faceLen = Math.hypot(ax, ay, az) || 1.0;
    const inv = 1.0 / faceLen; // make face ~1 unit tall

    for (let i = 0; i < NUM_LANDMARKS; i++) {
      raw[i * 3] = (raw[i * 3] - cx) * inv;
      raw[i * 3 + 1] = (raw[i * 3 + 1] - cy) * inv;
      raw[i * 3 + 2] = (raw[i * 3 + 2] - cz) * inv;
    }

    // 3. Push into ring buffer and average → smoothed landmarks.
    this.history[this.historyHead].set(raw);
    this.historyHead = (this.historyHead + 1) % this.history.length;

    const out = this.frame.landmarks;
    const N = this.history.length;
    for (let j = 0; j < NUM_LANDMARKS * 3; j++) {
      let s = 0;
      for (let h = 0; h < N; h++) s += this.history[h][j];
      out[j] = s / N;
    }

    // 4. Blendshapes.
    const bs = result.faceBlendshapes?.[0]?.categories;
    if (bs) {
      this.frame.blendshapes.clear();
      for (const c of bs) {
        if (c.categoryName) this.frame.blendshapes.set(c.categoryName, c.score);
      }
    }

    // 5. Head transform (kept for later stages; not applied to landmarks here).
    const m = result.facialTransformationMatrixes?.[0]?.data;
    if (m && m.length === 16) {
      this.transformMat.fromArray(m);
      this.frame.transform = this.transformMat;
    } else {
      this.frame.transform = null;
    }

    this.frame.hasFace = true;
  }
}

/** Open the webcam and wire it to a video element. */
export async function attachCamera(
  video: HTMLVideoElement,
  constraints: MediaStreamConstraints = {
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  },
): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  // Wait for actual dimensions.
  if (video.readyState < 2) {
    await new Promise<void>((res) => {
      video.addEventListener('loadeddata', () => res(), { once: true });
    });
  }
  return stream;
}

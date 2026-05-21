import './style.css';
import * as THREE from 'three';
import { Engine } from './app/Engine.ts';
import { FaceTracker, NUM_LANDMARKS, attachCamera } from './inputs/FaceTracker.ts';

const container = document.getElementById('app');
if (!container) throw new Error('#app container not found');

// ---------- Debug video preview (mirrored, top-right) ----------
const video = document.createElement('video');
video.id = 'debug-video';
video.autoplay = true;
video.playsInline = true;
video.muted = true;
document.body.appendChild(video);

// ---------- Status overlay ----------
const status = document.createElement('div');
status.id = 'status';
status.textContent = 'Запрашиваем доступ к камере…';
document.body.appendChild(status);

// ---------- Fullscreen toggle ----------
const fsBtn = document.createElement('button');
fsBtn.id = 'fs-btn';
fsBtn.type = 'button';
fsBtn.title = 'Полный экран (F)';
fsBtn.textContent = '⛶';
fsBtn.addEventListener('click', toggleFullscreen);
document.body.appendChild(fsBtn);

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}
document.addEventListener('fullscreenchange', () => {
  fsBtn.textContent = document.fullscreenElement ? '🗗' : '⛶';
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});

// ---------- Engine + scene ----------
const engine = new Engine({ container });
engine.camera.position.set(0, 0, 2.2);
engine.controls.target.set(0, 0, 0);
engine.controls.update();
engine.scene.add(new THREE.AmbientLight(0xffffff, 0.3));

// Reference grid (kept for spatial sense)
const grid = new THREE.GridHelper(4, 8, 0x223344, 0x111122);
grid.position.y = -1.2;
engine.scene.add(grid);

// ---------- Debug landmark cloud (468 Points) ----------
const lmGeometry = new THREE.BufferGeometry();
const lmPositions = new Float32Array(NUM_LANDMARKS * 3);
lmGeometry.setAttribute('position', new THREE.BufferAttribute(lmPositions, 3));
const lmMaterial = new THREE.PointsMaterial({
  color: 0x66ddff,
  size: 0.018,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const landmarkPoints = new THREE.Points(lmGeometry, lmMaterial);
engine.scene.add(landmarkPoints);

// ---------- Face tracker ----------
const tracker = new FaceTracker({ video, smoothing: 3 });

async function boot(): Promise<void> {
  try {
    status.textContent = 'Открываем камеру…';
    await attachCamera(video);
    status.textContent = 'Загружаем модель MediaPipe…';
    await tracker.init();
    status.textContent = 'Покажи лицо камере 🙂';
  } catch (err) {
    status.textContent = `Ошибка: ${(err as Error).message}`;
    status.classList.add('error');
    throw err;
  }
}

void boot();

// ---------- Per-frame update ----------
const positionAttr = lmGeometry.getAttribute('position') as THREE.BufferAttribute;

engine.onUpdate(() => {
  const updated = tracker.update();
  if (!updated) return;

  if (tracker.frame.hasFace) {
    lmPositions.set(tracker.frame.landmarks);
    positionAttr.needsUpdate = true;
    lmGeometry.computeBoundingSphere();
    landmarkPoints.visible = true;
    if (status.textContent !== '') status.textContent = '';
  } else {
    landmarkPoints.visible = false;
    if (!status.textContent) status.textContent = 'Лицо не найдено';
  }
});

engine.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    engine.dispose();
    tracker.dispose();
    const stream = video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    video.remove();
    status.remove();
  });
}

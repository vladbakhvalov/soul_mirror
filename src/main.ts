import './style.css';
import * as THREE from 'three';
import { Engine } from './app/Engine.ts';

const container = document.getElementById('app');
if (!container) throw new Error('#app container not found');

const engine = new Engine({ container });

// Ambient + key light (cube uses MeshStandardMaterial as a sanity test of lighting + bloom)
engine.scene.add(new THREE.AmbientLight(0xffffff, 0.15));
const key = new THREE.PointLight(0xff66cc, 4, 20, 1.5);
key.position.set(2, 2, 3);
engine.scene.add(key);

// Glowing test cube — emissive so bloom has something to grab
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({
    color: 0x111122,
    emissive: 0x4488ff,
    emissiveIntensity: 0.8,
    roughness: 0.3,
    metalness: 0.6,
  }),
);
engine.scene.add(cube);

// Subtle background grid for depth perception (kept dark to not blow out bloom)
const grid = new THREE.GridHelper(20, 20, 0x222244, 0x111122);
grid.position.y = -1.5;
engine.scene.add(grid);

engine.onUpdate((dt) => {
  cube.rotation.x += dt * 0.6;
  cube.rotation.y += dt * 0.8;
});

engine.start();

// Hot module reload cleanup (Vite)
if (import.meta.hot) {
  import.meta.hot.dispose(() => engine.dispose());
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

// Lighting
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 7.5);
scene.add(light);

// Ground
const platform = new THREE.Mesh(
  new THREE.BoxGeometry(100, 0.2, 100),
  new THREE.MeshStandardMaterial({ color: 0x888888 })
);
platform.position.y = -1;
scene.add(platform);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.update();

// Robot
let robro = null;
const clock = new THREE.Clock();
let keys = { w: false, a: false, s: false, d: false, shift: false };

// Load Robro
const originalRotations = {};

loader.load('Robro6.glb', (gltf) => {
  robro = gltf.scene;
  robro.rotation.y = -Math.PI / 2;
  robro.position.set(0, -0.8, 0);
  robro.scale.set(1, 1, 1);
  scene.add(robro);

  // Save initial joint rotations
  ["LeftThigh", "RightThigh", "LeftFoot", "RightFoot", "LeftShoulder", "RightShoulder"].forEach(name => {
    const part = robro.getObjectByName(name);
    if (part) originalRotations[name] = part.rotation.clone();
  });
}, undefined, console.error);


// Input
window.addEventListener('keydown', (e) => {
  if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (e) => {
  if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = false;
});

// Joint Animation
function simulateJointWalk() {
  if (!robro) return;

  const t = clock.getElapsedTime() * 4;
  const base = 1.4;

  const parts = {
    leftThigh: robro.getObjectByName("LeftThigh"),
    rightThigh: robro.getObjectByName("RightThigh"),
    leftFoot: robro.getObjectByName("LeftFoot"),
    rightFoot: robro.getObjectByName("RightFoot"),
    leftShoulder: robro.getObjectByName("LeftShoulder"),
    rightShoulder: robro.getObjectByName("RightShoulder")
  };

  if (parts.leftThigh) parts.leftThigh.rotation.set(0, 0, Math.sin(t) * 0.3);
  if (parts.rightThigh) parts.rightThigh.rotation.set(0, 0, Math.sin(t + Math.PI) * 0.3);
  if (parts.leftFoot) parts.leftFoot.rotation.set(0, 0, Math.sin(t + Math.PI) * 0.15);
  if (parts.rightFoot) parts.rightFoot.rotation.set(0, 0, Math.sin(t) * 0.15);

  const baseDown = 0; // use neutral if arm is rotated backward initially

if (parts.leftShoulder) {
    // Try .z first — this often works when x fails
    parts.leftShoulder.rotation.set(0, 0, baseDown + Math.sin(t + Math.PI) * 0.6);
}

if (parts.rightShoulder) {
    // Invert swing and maybe flip sign for mirrored bone
    parts.rightShoulder.rotation.set(0, 0, baseDown - Math.sin(t) * 0.6);
}

}

function resetIdlePose() {
  for (const [name, rot] of Object.entries(originalRotations)) {
    const part = robro.getObjectByName(name);
    if (part) part.rotation.copy(rot);
  }
}


// Movement Logic
function updateRobotMovement() {
  if (!robro) return;

  const moveDir = new THREE.Vector3();
  if (keys.w) moveDir.z -= 1;
  if (keys.s) moveDir.z += 1;
  if (keys.a) moveDir.x -= 1;
  if (keys.d) moveDir.x += 1;

  if (moveDir.length() > 0) {
    moveDir.normalize();
    const speed = keys.shift ? 0.1 : 0.05;

    const localDir = moveDir.clone().applyQuaternion(robro.quaternion);
    robro.position.add(localDir.multiplyScalar(speed));

    const targetQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      moveDir.clone().normalize()
    );
    robro.quaternion.slerp(targetQuat, 0.2);

    simulateJointWalk();
  } else {
    resetIdlePose();
  }
}

// Animation Loop
function animate() {
  requestAnimationFrame(animate);
  updateRobotMovement();
  controls.update();
  renderer.render(scene, camera);
}

animate();

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
platform.position.y = -1.275;
scene.add(platform);

// Wall (obstacle)
const wall = new THREE.Mesh(
  new THREE.BoxGeometry(3, 4, 0.5),
  new THREE.MeshStandardMaterial({ color: 0xff4444 })
);
wall.position.set(0, 0.8, -5);  // in front of starting point
scene.add(wall);

// Collision bounding boxes
const robotBox = new THREE.Box3();
const wallBox = new THREE.Box3().setFromObject(wall);

// Robot and input
let robro = null;
const clock = new THREE.Clock();
let keys = { w: false, a: false, s: false, d: false, shift: false };

let airMoveVector = new THREE.Vector3();


// Jump physics
let velocityY = 0;
let isOnGround = true;
const gravity = -0.03;
const jumpStrength = 0.65;
let isPreparingJump = false;
const crouchDuration = 200;

const originalRotations = {};

// Load Robro
const loader = new GLTFLoader();
loader.load('Robro6.glb', (gltf) => {
  robro = gltf.scene;
  robro.position.set(0, -0.8, 0);
  robro.scale.set(1, 1, 1);
  scene.add(robro);

  ["LeftThigh", "RightThigh", "LeftFoot", "RightFoot", "LeftShoulder", "RightShoulder", "RightLeg", "LeftLeg"].forEach(name => {
    const part = robro.getObjectByName(name);
    if (part) originalRotations[name] = part.rotation.clone();
  });

  resetIdlePose();
}, undefined, (error) => {
  console.error("Failed to load Robro:", error);
});
// Terrain integration
const terrainLoader = new GLTFLoader();
const terrainMeshes = []; // keep it global if not already

terrainLoader.load('UnevenTerrain.glb', (gltf) => {
  const terrain = gltf.scene;
  terrain.scale.set(10, 5, 10);
  terrain.position.set(0, -1.275, 0); // Align with ground
  scene.add(terrain);

  terrain.traverse((child) => {
    if (child.isMesh) {
      terrainMeshes.push(child);
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
});


// Input
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (keys.hasOwnProperty(key)) keys[key] = true;

  // Pre-jump crouch logic
  if (e.code === 'Space' && isOnGround && !isPreparingJump) {
    isPreparingJump = true;

    const leftleg = robro.getObjectByName("LeftLeg");
    const rightleg = robro.getObjectByName("RightLeg");

    if (leftleg) leftleg.rotation.z += THREE.MathUtils.degToRad(-25);
    if (rightleg) rightleg.rotation.z += THREE.MathUtils.degToRad(-25);

    setTimeout(() => {
      velocityY = jumpStrength;
      isOnGround = false;
      isPreparingJump = false;
      robro.position.y += 0.2;
      resetIdlePose();
    }, crouchDuration);
  }
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (keys.hasOwnProperty(key)) keys[key] = false;
});

// Joint Animation
function simulateJointWalk() {
  if (!robro) return;

  const t = clock.getElapsedTime() * 6;
  const speedFactor = keys.shift ? 0.7 : 0.4;

  const parts = {
    leftThigh: robro.getObjectByName("LeftThigh"),
    rightThigh: robro.getObjectByName("RightThigh"),
    leftFoot: robro.getObjectByName("LeftFoot"),
    rightFoot: robro.getObjectByName("RightFoot"),
    leftShoulder: robro.getObjectByName("LeftShoulder"),
    rightShoulder: robro.getObjectByName("RightShoulder")
  };

  const legSwing = Math.sin(t) * 0.4 * speedFactor;
  const footLift = Math.cos(t) * 0.25 * speedFactor;
  const armSwing = Math.sin(t) * 0.6;

  if (parts.leftThigh) parts.leftThigh.rotation.set(0, 0, legSwing);
  if (parts.rightThigh) parts.rightThigh.rotation.set(0, 0, -legSwing);
  if (parts.leftFoot) parts.leftFoot.rotation.set(0, 0, -footLift);
  if (parts.rightFoot) parts.rightFoot.rotation.set(0, 0, footLift);

  if (parts.leftShoulder) parts.leftShoulder.rotation.set(0, 0, -armSwing);
  if (parts.rightShoulder) parts.rightShoulder.rotation.set(0, 0, armSwing);
}

function resetIdlePose() {
  for (const [name, rot] of Object.entries(originalRotations)) {
    const part = robro.getObjectByName(name);
    if (part) part.rotation.copy(rot);
  }
}

// Movement Logic with Collision Check
function updateRobotMovement() {
  if (!robro) return;

  const speed = keys.shift ? 0.7 : 0.4;
  let moveStep = new THREE.Vector3();

  // Define robot's forward direction
  const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(robro.quaternion);
  // const forward = new THREE.Vector3(0, 0, -1)
  forward.y = 0;
  forward.normalize();

  // Handle movement keys
  if (keys.w) moveStep.add(forward.clone().multiplyScalar(speed));
  if (keys.s) moveStep.add(forward.clone().multiplyScalar(-speed));

  // Handle rotation with A/D
  if (keys.a) robro.rotation.y += 0.05;
  if (keys.d) robro.rotation.y -= 0.05;

  // Only move if on ground and not preparing jump
  const isMoving = (keys.w || keys.s);

  if (isMoving && isOnGround && !isPreparingJump) {
    // Collision-aware movement
    const futurePosition = robro.position.clone().add(moveStep);
    robotBox.setFromObject(robro);
    robotBox.translate(moveStep);
    const willCollide = robotBox.intersectsBox(wallBox);
  
    if (!willCollide) {
      robro.position.add(moveStep);  // Move step by step
      airMoveVector.copy(moveStep); // Save for jump inertia
    }
  
    simulateJointWalk();  // Animate walk
  } else if (isOnGround && !isPreparingJump) {
    resetIdlePose();  // Reset legs if idle
  }
  

  // Jump physics
  if (!isOnGround) {
    velocityY += gravity;
    robro.position.y += velocityY;

    robro.position.add(airMoveVector.clone());
    airMoveVector.multiplyScalar(0.98); // Dampen slowly

    const leftShoulder = robro.getObjectByName("LeftShoulder");
    const rightShoulder = robro.getObjectByName("RightShoulder");

    if (leftShoulder && originalRotations["LeftShoulder"])
      leftShoulder.rotation.z = originalRotations["LeftShoulder"].z - THREE.MathUtils.degToRad(30);
    if (rightShoulder && originalRotations["RightShoulder"])
      rightShoulder.rotation.z = originalRotations["RightShoulder"].z - THREE.MathUtils.degToRad(30);

    if (robro.position.y <= -0.8) {
      robro.position.y = -0.8;
      velocityY = 0;
      isOnGround = true;
      resetIdlePose();
    }
  }
  //terrain logic
  // Terrain-following height adjustment (simulate climb)
if (robro) {
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const robotFeet = robro.position.clone();
  raycaster.set(robotFeet, down);

  const intersects = raycaster.intersectObjects(terrainMeshes, true);
  if (intersects.length > 0) {
    const terrainY = intersects[0].point.y + 0.8; // add robot height offset
    const deltaY = terrainY - robro.position.y;

    // Smoothly climb up/down small elevation changes
    if (Math.abs(deltaY) < 1.2) {//1.2
      robro.position.y += deltaY * 0.2; // 0.2 = smooth interpolation
    }}};
}


// Animation Loop
function animate() {
  requestAnimationFrame(animate);
  updateRobotMovement();

  if (robro) {
    const followOffset = new THREE.Vector3(-10, 10, 0);
    const robotWorldPos = new THREE.Vector3();
    robro.getWorldPosition(robotWorldPos);

    if (keys.s && !keys.w) {
      followOffset.set(15, 10, 0); // Move in front of robot
    }
  

    const rotatedOffset = followOffset.clone().applyQuaternion(robro.quaternion);

    // const desiredCameraPos = followOffset.clone().applyQuaternion(robro.quaternion).add(robotWorldPos);
    const desiredCameraPos = robotWorldPos.clone().add(rotatedOffset);
    camera.position.lerp(desiredCameraPos, 0.1);
    camera.lookAt(robotWorldPos.clone().add(new THREE.Vector3(0, 2, 0)));
  }

  renderer.render(scene, camera);
}

animate();

//Chote Platform se bade platform jaa pa raha hai 
//skipping big platform (fix)
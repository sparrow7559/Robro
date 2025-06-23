import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 7.5);
scene.add(light);

const platform = new THREE.Mesh(
  new THREE.BoxGeometry(100, 0.2, 100),
  new THREE.MeshStandardMaterial({ color: 0x888888 })
);
platform.position.y = -1.275;
scene.add(platform);

const wall = new THREE.Mesh(
  new THREE.BoxGeometry(3, 4, 0.5),
  new THREE.MeshStandardMaterial({ color: 0xff4444 })
);
wall.position.set(0, 0.8, -5);
scene.add(wall);

const robotBox = new THREE.Box3();
const wallBox = new THREE.Box3().setFromObject(wall);

let robro = null;
const clock = new THREE.Clock();
let keys = { w: false, a: false, s: false, d: false, shift: false };
let airMoveVector = new THREE.Vector3();
let velocityY = 0;
let isOnGround = true;
const gravity = -0.03;
const jumpStrength = 0.65;
let isPreparingJump = false;
const crouchDuration = 200;
const originalRotations = {};

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
}, undefined, console.error);

const terrainLoader = new GLTFLoader();
const terrainTiles = [];
let baseTile;
const tileSize = 20;
const scaleFactor = 5;
// const scaleFactor =10;
const tileRepeat = 3;

terrainLoader.load('UnevenTerrain.glb', (gltf) => {
  baseTile = gltf.scene;
  baseTile.scale.set(scaleFactor, scaleFactor, scaleFactor);
  createTerrainGrid();
});

function createTerrainGrid() {
  const half = Math.floor(tileRepeat / 2);
  const tileSpacing = tileSize * scaleFactor * 0.99;
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      const tile = baseTile.clone(true);
      tile.position.set(i * tileSpacing, -0.8, j * tileSpacing);
      scene.add(tile);
      terrainTiles.push(tile);
    }
  }
}

function resetIdlePose() {
  for (const [name, rot] of Object.entries(originalRotations)) {
    const part = robro.getObjectByName(name);
    if (part) part.rotation.copy(rot);
  }
}

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (keys.hasOwnProperty(key)) keys[key] = true;

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

function updateRobotMovement() {
  if (!robro || terrainTiles.length === 0) return;

  const speed = keys.shift ? 0.7 : 0.4;
  let moveStep = new THREE.Vector3();
  const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(robro.quaternion);
  forward.y = 0;
  forward.normalize();

  if (keys.w) moveStep.add(forward.clone().multiplyScalar(speed));
  if (keys.s) moveStep.add(forward.clone().multiplyScalar(-speed));
  if (keys.a) robro.rotation.y += 0.05;
  if (keys.d) robro.rotation.y -= 0.05;

  const isMoving = (keys.w || keys.s);

  // --- CLIMB/STEP LOGIC START ---
  const waistHeight = 0.8; // Adjust as needed for your model
  let canMove = true;
  let smoothStepTargetY = null;

  if (isMoving && isOnGround && !isPreparingJump) {
    const moveDirection = moveStep.clone().normalize();
    if (moveDirection.length() > 0) {
      const rayOrigin = robro.position.clone();
      rayOrigin.y += 0.1; // Just above ground
      const raycaster = new THREE.Raycaster(rayOrigin, moveDirection, 0, speed + 0.6);
      const obstacles = [wall, ...terrainTiles];
      const hits = raycaster.intersectObjects(obstacles, true);
      if (hits.length > 0) {
        // Find the highest y among all hits in the move direction
        let maxY = -Infinity;
        let minDistance = Infinity;
        let bestHit = null;
        for (const hit of hits) {
          if (hit.distance < minDistance) {
            minDistance = hit.distance;
            maxY = hit.point.y;
            bestHit = hit;
          }
        }
        const robotWaistY = robro.position.y + waistHeight;
        if (maxY < robotWaistY) {
          // Smoothly step up
          smoothStepTargetY = maxY;
        } else {
          canMove = false; // Block movement
        }
      }
    }
  }

  if (isMoving && isOnGround && !isPreparingJump) {
    const futurePosition = robro.position.clone().add(moveStep);
    robotBox.setFromObject(robro);
    robotBox.translate(moveStep);
    const willCollide = robotBox.intersectsBox(wallBox);

    if (canMove && !willCollide) {
      if (smoothStepTargetY !== null) {
        // Smoothly interpolate Y to the step height
        robro.position.y += (smoothStepTargetY - robro.position.y) * 0.2;
      }
      robro.position.add(moveStep);
      airMoveVector.copy(moveStep);
    }
    simulateJointWalk();
  } else if (isOnGround && !isPreparingJump) {
    resetIdlePose();
  }

  if (!isOnGround) {
    velocityY += gravity;
    robro.position.y += velocityY;
    robro.position.add(airMoveVector.clone());
    airMoveVector.multiplyScalar(0.98);

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

  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(robro.position.x, 20, robro.position.z),
    new THREE.Vector3(0, -1, 0)
  );
  let intersections = [];
  for (let tile of terrainTiles) {
    const hits = raycaster.intersectObject(tile, true);
    if (hits.length > 0) intersections.push(...hits);
  }

  if (intersections.length > 0) {
    intersections.sort((a, b) => a.distance - b.distance);
    const terrainY = intersections[0].point.y;
  
    // Use a fixed offset to keep the robot slightly above terrain
    const robotFootOffset = 0.8; // You can tweak this for your model
    const targetY = terrainY + robotFootOffset;
    const deltaY = targetY - robro.position.y;
  
    if (Math.abs(deltaY) < 1.5) {
      robro.position.y += deltaY * 0.2;
    }
  }
  
}

function animate() {
  requestAnimationFrame(animate);
  updateRobotMovement();

  if (robro) {
    const followOffset = new THREE.Vector3(-10, 10, 0);
    const robotWorldPos = new THREE.Vector3();
    robro.getWorldPosition(robotWorldPos);

    if (keys.s && !keys.w) {
      followOffset.set(15, 10, 0);
    }

    const rotatedOffset = followOffset.clone().applyQuaternion(robro.quaternion);
    const desiredCameraPos = robotWorldPos.clone().add(rotatedOffset);
    camera.position.lerp(desiredCameraPos, 0.1);
    camera.lookAt(robotWorldPos.clone().add(new THREE.Vector3(0, 2, 0)));
  }

  renderer.render(scene, camera);
}

animate();

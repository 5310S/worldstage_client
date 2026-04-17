import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const canvas = document.getElementById('worldstage-scene');
const shouldSkipIntro = window.__worldstageSkipIntro === true;

if (!canvas || !window.WebGLRenderingContext) {
  throw new Error('worldstage_scene_unavailable');
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040509);
scene.fog = new THREE.FogExp2(0x040509, 0.0125);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 260);
camera.position.set(0, 0, 8);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

camera.lookAt(0, 0, -18);

function makeGlowTexture(size) {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = size;
  canvasEl.height = size;
  const context = canvasEl.getContext('2d');
  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.22, 'rgba(255,245,232,0.96)');
  gradient.addColorStop(0.44, 'rgba(164,194,255,0.42)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeStarburstTexture(size) {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = size;
  canvasEl.height = size;
  const context = canvasEl.getContext('2d');
  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,250,245,0.98)');
  gradient.addColorStop(0.36, 'rgba(171,201,255,0.45)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  context.save();
  context.translate(center, center);
  context.strokeStyle = 'rgba(255,255,255,0.68)';
  context.lineWidth = Math.max(1, size * 0.012);
  for (const angle of [0, Math.PI / 4]) {
    context.save();
    context.rotate(angle);
    context.beginPath();
    context.moveTo(-center * 0.9, 0);
    context.lineTo(center * 0.9, 0);
    context.stroke();
    context.restore();
  }
  context.restore();

  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeStars(count, spread, size, opacity, palette, texture) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    positions[offset] = (Math.random() - 0.5) * spread;
    positions[offset + 1] = (Math.random() - 0.5) * spread * 0.72;
    positions[offset + 2] = (Math.random() - 0.5) * spread;

    color.setHex(palette[Math.floor(Math.random() * palette.length)]);
    color.toArray(colors, offset);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size,
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });

  return new THREE.Points(geometry, material);
}

const starRoot = new THREE.Group();
scene.add(starRoot);

const softStarTexture = makeGlowTexture(128);
const burstStarTexture = makeStarburstTexture(192);

const distantStars = makeStars(560000, 240, 0.08, 0.98, [0xffffff, 0xe7efff, 0xc8d9ff, 0xffead8, 0xffd9f4, 0xd7fff1, 0xcfc6ff], softStarTexture);
const midStars = makeStars(168000, 175, 0.14, 0.86, [0xffffff, 0xdbe7ff, 0xb8cfff, 0xffddcf, 0xffc3ea, 0xc9fff2, 0xc4b7ff], softStarTexture);
const nearGlow = makeStars(36000, 118, 0.24, 0.62, [0xffffff, 0xd4e2ff, 0xffd8ce, 0xffb8df, 0xb9ffef, 0xd1c5ff], burstStarTexture);

starRoot.add(distantStars);
starRoot.add(midStars);
starRoot.add(nearGlow);

const STAR_FADE_IN_MS = 1900;
const APPROACH_MS = 7000;
const APPROACH_DELAY_MS = 150;
const APPROACH_RAMP_MS = 1000;
const APPROACH_START_Z = 42;
const APPROACH_END_Z = 8;
const POST_APPROACH_CRUISE_SPEED_Z = 0.02;
const FRAME_MIN_SCALE = 0.02;
const FRAME_MAX_SCALE = 1;
const starFadeMaterials = [];
const frameStage = document.querySelector('.worldstage-frame-stage');
let starFadeStartMs = 0;
let flightStartMs = 0;
let lastFrameMs = 0;
let starsReadyDispatched = false;
let approachDoneDispatched = false;
let starDriftZ = 0;
let approachStartMs = 0;

function registerStarFadeMaterial(material) {
  if (!material || typeof material.opacity !== 'number') return;
  starFadeMaterials.push({
    material,
    targetOpacity: material.opacity
  });
  material.opacity = 0;
  material.transparent = true;
}

starRoot.traverse((node) => {
  if (!node || !node.material) return;
  const mats = Array.isArray(node.material) ? node.material : [node.material];
  mats.forEach(registerStarFadeMaterial);
});

function addStarbursts() {
  const spriteMaterial = new THREE.SpriteMaterial({
    map: burstStarTexture,
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const placements = [
    { x: -9.5, y: 6.4, z: -34, scale: 2.4, color: 0xe8f1ff },
    { x: 11.3, y: -5.1, z: -28, scale: 1.9, color: 0xfff1e1 },
    { x: 7.8, y: 8.5, z: -40, scale: 1.6, color: 0xd2ddff },
    { x: -13.6, y: -7.7, z: -32, scale: 2.8, color: 0xf4e7ff },
    { x: 3.2, y: -9.4, z: -26, scale: 2.2, color: 0xfff8ee },
    { x: -4.8, y: 10.1, z: -37, scale: 1.7, color: 0xd6e6ff },
    { x: 14.2, y: 2.6, z: -35, scale: 2.0, color: 0xffe8dd },
    { x: -15.8, y: 0.8, z: -41, scale: 2.1, color: 0xffbfe7 },
    { x: 5.9, y: 12.2, z: -33, scale: 1.8, color: 0xc5fff0 },
    { x: 0.8, y: 7.1, z: -29, scale: 1.6, color: 0xd6c8ff },
    { x: -8.4, y: -11.6, z: -30, scale: 2.3, color: 0xffd5b6 },
    { x: 16.1, y: -3.8, z: -39, scale: 1.9, color: 0xbfd7ff }
  ];

  placements.forEach((placement) => {
    const sprite = new THREE.Sprite(spriteMaterial.clone());
    sprite.material.color = new THREE.Color(placement.color);
    registerStarFadeMaterial(sprite.material);
    sprite.position.set(placement.x, placement.y, placement.z);
    sprite.scale.setScalar(placement.scale);
    starRoot.add(sprite);
  });
}

addStarbursts();

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderScene();
}

window.addEventListener('resize', onResize);

function renderScene() {
  renderer.render(scene, camera);
}

function easeOutCubic(value) {
  const t = Math.max(0, Math.min(1, value));
  return 1 - ((1 - t) ** 3);
}

function lerp(from, to, t) {
  return from + ((to - from) * t);
}

function smoothstep01(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - (2 * t));
}

function renderFlightFrame(nowMs) {
  if (!flightStartMs) {
    flightStartMs = nowMs;
    starFadeStartMs = nowMs;
    lastFrameMs = nowMs;
  }

  const elapsed = nowMs - flightStartMs;
  const fade = Math.max(0, Math.min(1, (nowMs - starFadeStartMs) / STAR_FADE_IN_MS));
  const approachStarted = Boolean(approachStartMs) && nowMs >= approachStartMs;
  const approachElapsed = approachStarted ? (nowMs - approachStartMs) : 0;
  const approachProgress = Math.max(0, Math.min(1, approachElapsed / APPROACH_MS));
  const easedApproach = smoothstep01(approachProgress);
  const deltaSecs = Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000));
  const approachRamp = approachStarted ? smoothstep01(approachElapsed / APPROACH_RAMP_MS) : 0;

  for (const entry of starFadeMaterials) {
    entry.material.opacity = entry.targetOpacity * fade;
  }

  // Keep stars moving toward camera so forward flight is visually obvious.
  const driftSpeed = approachStarted ? ((approachProgress < 1 ? 0 : 0.06) * approachRamp) : 0;
  starDriftZ += driftSpeed * deltaSecs;
  starRoot.position.z = starDriftZ;

  if (!approachStarted) {
    camera.position.z = APPROACH_START_Z;
    camera.position.x = 0;
    camera.position.y = 0;
  } else if (approachProgress < 1) {
    const approachZ = lerp(APPROACH_START_Z, APPROACH_END_Z, easedApproach);
    camera.position.z = approachZ;
    camera.position.x = 0;
    camera.position.y = 0;
  } else {
    camera.position.z -= (POST_APPROACH_CRUISE_SPEED_Z * Math.max(0.2, approachRamp)) * deltaSecs;
    camera.position.x = 0;
    camera.position.y = 0;
  }

  camera.lookAt(0, 0, -18);

  if (frameStage) {
    const stageScale = approachStarted
      ? lerp(FRAME_MIN_SCALE, FRAME_MAX_SCALE, easedApproach)
      : FRAME_MIN_SCALE;
    frameStage.style.transform = `scale(${stageScale})`;
  }

  if (!starsReadyDispatched && fade >= 1) {
    starsReadyDispatched = true;
    if (!approachStartMs) {
      approachStartMs = nowMs + APPROACH_DELAY_MS;
    }
    window.dispatchEvent(new CustomEvent('worldstage-stars-ready'));
  }

  if (!approachDoneDispatched && approachStarted && approachProgress >= 1) {
    approachDoneDispatched = true;
    window.dispatchEvent(new CustomEvent('worldstage-approach-complete'));
  }

  lastFrameMs = nowMs;
  renderScene();
  window.requestAnimationFrame(renderFlightFrame);
}

if (shouldSkipIntro) {
  if (frameStage) {
    frameStage.style.transform = `scale(${FRAME_MAX_SCALE})`;
  }
  for (const entry of starFadeMaterials) {
    entry.material.opacity = entry.targetOpacity;
  }
  camera.position.set(0, 0, APPROACH_END_Z);
  camera.lookAt(0, 0, -18);
  renderScene();
  starsReadyDispatched = true;
  approachDoneDispatched = true;
  window.dispatchEvent(new CustomEvent('worldstage-stars-ready'));
  window.dispatchEvent(new CustomEvent('worldstage-approach-complete'));
} else {
  window.requestAnimationFrame(renderFlightFrame);
}

onResize();

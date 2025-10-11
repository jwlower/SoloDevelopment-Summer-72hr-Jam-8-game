import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gsap } from 'gsap';
import { Cube } from './cube.js';

/* =========================================================================
   DOM references
   ========================================================================= */
const setupScreen = document.getElementById('setupScreen');
const playScreen = document.getElementById('playScreen');

const startSessionBtn = document.getElementById('startSessionBtn');
const backBtn = document.getElementById('backBtn');

const shuffleBtn = document.getElementById('shuffleBtn');
const solveBtn = document.getElementById('solveBtn');
const playBtn = document.getElementById('playBtn');
const resetBtn = document.getElementById('resetBtn');

const gameModeCheckbox = document.getElementById('setupGameMode');
const gameHud = document.getElementById('gameHud');
const gameStartBtn = document.getElementById('gameStartBtn'); // START (shuffle once)
const gameGoBtn = document.getElementById('gameGoBtn');    // GO   (one solve step)
const movesLeftCount = document.getElementById('movesLeftCount');

/* =========================================================================
   Three.js scene
   ========================================================================= */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 1000
);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
document.getElementById('playScreen').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

/* =========================================================================
   App state
   ========================================================================= */
let CUBE_SIZE = 3;
let SHUFFLE_MOVES_COUNT = 12;

let cube = null;               // current Cube instance
let SHUFFLE_MOVES = [];        // the scramble sequence from the last shuffle
let solveQueue = [];           // inverse of SHUFFLE_MOVES for step-by-step solving

let inGameMode = false;        // whether we’re in “game mode”
let gamePhase = 'pre';        // 'pre' (not shuffled yet) | 'solving'
let playing = false;        // whether Play loop is running

// rotation queue to avoid simultaneous GSAP tweens
let isRotating = false;
const moveQueue = [];

/* =========================================================================
   Utilities
   ========================================================================= */
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// list of index positions for a layer, centered around 0
function layerIndices(size) {
    const half = (size - 1) / 2;   // 3 -> 1, 4 -> 1.5
    return Array.from({ length: size }, (_, i) => -half + i);
}

function setMainControlsDisabled(disabled) {
    shuffleBtn.disabled = disabled;
    solveBtn.disabled = disabled;
    playBtn.disabled = disabled;
    // reset/back remain available
}

async function cancelAllAnimations() {
    // stop any background “play” loop
    playing = false;

    // stop GSAP tweens cleanly
    const activeTweens = gsap.globalTimeline.getChildren(false, true, false);
    await Promise.all(
        activeTweens.map(t => new Promise(res => {
            if (t.isActive()) t.eventCallback('onComplete', res);
            else res();
        }))
    );
    gsap.globalTimeline.clear();

    // clear any queued rotations
    moveQueue.length = 0;
    isRotating = false;
}


function hideGameHudAccessibly() {
    if (gameHud.contains(document.activeElement)) {
        const fallback = backBtn || document.body;
        if (fallback && fallback.focus) fallback.focus();
        if (document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
    }
    gameHud.setAttribute('aria-hidden', 'true');
    gameHud.classList.remove('show');
    // prevent tabbing / clicks:
    gameHud.setAttribute('inert', '');
}

function showGameHud(show) {
    if (!gameHud) return;
    if (show) {
        gameHud.removeAttribute('inert');
        gameHud.classList.add('show');
        gameHud.setAttribute('aria-hidden', 'false');
    } else {
        hideGameHudAccessibly();
    }
}

function updateMovesLeft() {
    movesLeftCount.textContent = String(solveQueue.length || 0);
}

/* =========================================================================
   Game mode lifecycle
   ========================================================================= */
async function enterGameMode() {
    inGameMode = true;
    gamePhase = 'pre';

    await cancelAllAnimations();   // <- ensures no leftover shuffle/play runs

    SHUFFLE_MOVES = [];
    solveQueue = [];

    setMainControlsDisabled(true);
    showGameHud(true);
    updateMovesLeft();             // 0
}

function exitGameMode() {
    inGameMode = false;
    gamePhase = 'pre';
    SHUFFLE_MOVES = [];
    solveQueue = [];

    setMainControlsDisabled(false);
    showGameHud(false);
    updateMovesLeft();
}

/* =========================================================================
   Rotations (queued so no overlaps)
   ========================================================================= */
function rotateLayerQueued(cube, axis, index, angle, duration = 0.6) {
    return new Promise((resolve, reject) => {
        moveQueue.push({ cube, axis, index, angle, duration, resolve, reject });
        if (!isRotating) processNextMove();
    });
}

async function processNextMove() {
    if (isRotating || moveQueue.length === 0) return;
    isRotating = true;
    const { cube, axis, index, angle, duration, resolve, reject } = moveQueue.shift();
    try {
        await rotateLayer(cube, axis, index, angle, duration);
        resolve();
    } catch (e) {
        reject(e);
    } finally {
        isRotating = false;
        processNextMove();
    }
}

// Your existing rotate function, with snap + reparent baked in. (Based on your current code.) :contentReference[oaicite:1]{index=1}
function rotateLayer(cube, axis, index, angle, duration = 0.6) {
    return new Promise(resolve => {
        const layerCubelets = cube.getLayer(axis, index);
        const layerGroup = new THREE.Group();

        // reparent all meshes into a temporary group
        layerCubelets.forEach(cubelet => {
            cube.group.remove(cubelet.mesh);
            layerGroup.add(cubelet.mesh);
        });
        scene.add(layerGroup);

        gsap.to(layerGroup.rotation, {
            [axis]: angle,
            duration,
            onComplete: () => {
                layerGroup.updateMatrixWorld(true);

                layerCubelets.forEach(cubelet => {
                    // bake group transform into each mesh
                    cubelet.mesh.applyMatrix4(layerGroup.matrix);

                    // snap position to half-steps to avoid drift
                    ['x', 'y', 'z'].forEach(a => {
                        cubelet.mesh.position[a] = Math.round(cubelet.mesh.position[a] * 2) / 2;
                    });

                    // snap rotation to 90° steps
                    ['x', 'y', 'z'].forEach(a => {
                        const steps = Math.round(cubelet.mesh.rotation[a] / (Math.PI / 2));
                        cubelet.mesh.rotation[a] = steps * (Math.PI / 2);
                    });

                    scene.remove(layerGroup);
                    cube.group.add(cubelet.mesh);
                });

                resolve();
            }
        });
    });
}

/* =========================================================================
   Shuffle / Solve
   ========================================================================= */
async function shuffleCube(cube, movesCount, solveAfter = false) {
    const idxs = layerIndices(cube.size);
    const axes = ['x', 'y', 'z'];

    // fresh list each time we shuffle (no double-playback)
    SHUFFLE_MOVES = [];
    for (let i = 0; i < movesCount; i++) {
        const axis = axes[Math.floor(Math.random() * axes.length)];
        const index = idxs[Math.floor(Math.random() * idxs.length)];
        const angle = Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2;
        SHUFFLE_MOVES.push({ axis, index, angle });
    }

    // play the scramble
    for (const m of SHUFFLE_MOVES) {
        await rotateLayerQueued(cube, m.axis, m.index, m.angle, 0.6);
    }

    if (solveAfter) {
        // immediately solve it back (not used in game mode)
        for (const m of SHUFFLE_MOVES.slice().reverse()) {
            await rotateLayerQueued(cube, m.axis, m.index, -m.angle, 0.6);
        }
    }
}

async function solveCube(cube) {
    for (const m of SHUFFLE_MOVES.slice().reverse()) {
        await rotateLayerQueued(cube, m.axis, m.index, -m.angle, 0.6);
    }
    SHUFFLE_MOVES = [];
}

/* =========================================================================
   Session lifecycle
   ========================================================================= */
async function startSession() {
    CUBE_SIZE = parseInt(document.getElementById('setupCubeSize').value, 10);
    SHUFFLE_MOVES_COUNT = parseInt(document.getElementById('setupShuffleMoves').value, 10);
    inGameMode = !!gameModeCheckbox.checked;

    showScreen('playScreen');

    await cancelAllAnimations();   // <- kill anything from a previous run

    if (cube) scene.remove(cube.getGroup());
    cube = new Cube(CUBE_SIZE);
    scene.add(cube.getGroup());

    if (inGameMode) await enterGameMode();
    else exitGameMode();
}

async function resetAll() {
    // Wait for active tweens (if any)
    const activeTweens = gsap.globalTimeline.getChildren(false, true, false);
    await Promise.all(activeTweens.map(t => new Promise(res => {
        if (t.isActive()) t.eventCallback('onComplete', res);
        else res();
    })));
    gsap.globalTimeline.clear();

    // Remove objects from scene
    while (scene.children.length > 0) {
        const obj = scene.children[0];
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
        }
    }

    // Rebuild cube
    cube = new Cube(CUBE_SIZE);
    scene.add(cube.getGroup());
    SHUFFLE_MOVES = [];
    solveQueue = [];
}

/* =========================================================================
   Event handlers
   ========================================================================= */
startSessionBtn.addEventListener('click', startSession);

backBtn.addEventListener('click', () => {
    playing = false;
    showScreen('setupScreen');
});

shuffleBtn.addEventListener('click', async () => {
    if (inGameMode) return; // shuffle in game mode should be done via START
    playing = false;
    await shuffleCube(cube, SHUFFLE_MOVES_COUNT, false);
});

solveBtn.addEventListener('click', async () => {
    if (inGameMode) return;
    playing = false;
    await solveCube(cube);
});

playBtn.addEventListener('click', async () => {
    if (inGameMode || playing) return;
    playing = true;
    while (playing) {
        await shuffleCube(cube, 1, true);
    }
});

resetBtn.addEventListener('click', async () => {
    playing = false;
    await resetAll();
    exitGameMode();
});

/* ----- Game HUD buttons ----- */

// START: only valid in game mode + pre-phase
gameStartBtn.addEventListener('click', async () => {
    if (!inGameMode || gamePhase !== 'pre' || isRotating) return;

    gameStartBtn.disabled = true;
    try {
        await shuffleCube(cube, SHUFFLE_MOVES_COUNT, false);  // <-- only here
        // build the inverse sequence for stepping
        solveQueue = SHUFFLE_MOVES.slice().reverse().map(m => ({
            axis: m.axis, index: m.index, angle: -m.angle,
        }));
        gamePhase = 'solving';
        updateMovesLeft();
    } finally {
        gameStartBtn.disabled = false;
    }
});

// GO: one solve step
gameGoBtn.addEventListener('click', async () => {
    if (!inGameMode || gamePhase !== 'solving' || !solveQueue.length || isRotating) return;

    const step = solveQueue.shift();
    await rotateLayerQueued(cube, step.axis, step.index, step.angle, 0.6);
    updateMovesLeft();

    if (solveQueue.length === 0) {
        exitGameMode(); // solved
    }
});

/* =========================================================================
   Render / Resize
   ========================================================================= */
function animate() {
    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

/* =========================================================================
   Boot
   ========================================================================= */
showScreen('setupScreen');

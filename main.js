import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gsap } from 'gsap';
import { Cube } from './cube.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

let CUBE_SIZE = document.getElementById("cubeSize").value; // 4x4 cube
let SHUFFLE_MOVES_COUNT = document.getElementById("shuffleMoves").value;
let SHUFFLE_MOVES = [];

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);

// KEEP the Cube instance (not just the group)
let cube = new Cube(CUBE_SIZE);
scene.add(cube.getGroup());
camera.position.z = 5;

// OrbitControls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05; 

// --- Layer rotation helper (unchanged API) ---
function rotateLayer(cube, axis, index, angle, duration = 1) {
    return new Promise(resolve => {
        const layerCubelets = cube.getLayer(axis, index);            
        const layerGroup = new THREE.Group();

        layerCubelets.forEach(cubelet => {
            cube.group.remove(cubelet.mesh);
            layerGroup.add(cubelet.mesh);
        });

        scene.add(layerGroup);

        gsap.to(layerGroup.rotation, {
            [axis]: angle,
            duration,
            // main.js (inside rotateLayer's onComplete)
            onComplete: () => {
                // ensure the group's matrix reflects final rotation
                layerGroup.updateMatrixWorld(true);

                layerCubelets.forEach(cubelet => {
                    // bake the layer transform into each cubelet
                    cubelet.mesh.applyMatrix4(layerGroup.matrix);

                    // SNAP to the nearest half step to avoid drift
                    ['x', 'y', 'z'].forEach(a => {
                        cubelet.mesh.position[a] = Math.round(cubelet.mesh.position[a] * 2) / 2;
                    });

                    // SNAP rotation to 90° steps to avoid tiny residuals
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

// --- One shuffle sequence (optionally auto-solve) ---
async function shuffleCube(cube, movesCount = SHUFFLE_MOVES_COUNT, solveAfter = true) {
    const axes = ['x', 'y', 'z']; 

    // build random moves
    for (let i = 0; i < movesCount; i++) {
        const axis = axes[Math.floor(Math.random() * axes.length)];
        const index = Math.floor(Math.random() * cube.size) - (cube.size - 1) / 2;
        const angle = Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2;
        SHUFFLE_MOVES.push({ axis, index, angle });
    }

    // play shuffle
    for (const move of SHUFFLE_MOVES) {
        await rotateLayer(cube, move.axis, move.index, move.angle, 0.6);
    }

    if (solveAfter) {
        // reverse to solve
        for (const move of SHUFFLE_MOVES.slice().reverse()) {
            await rotateLayer(cube, move.axis, move.index, -move.angle, 0.6);
        }
    }
}

async function solveCube(cube) {
    for (const move of SHUFFLE_MOVES.slice().reverse()) {
        await rotateLayer(cube, move.axis, move.index, -move.angle, 0.6);
    }

    SHUFFLE_MOVES = [];
}

async function reset() {
    // Wait for all active tweens to finish
    const activeTweens = gsap.globalTimeline.getChildren(false, true, false);
    await Promise.all(
        activeTweens.map(tween => {
            return new Promise(resolve => {
                if (tween.isActive()) {
                    tween.eventCallback('onComplete', resolve);
                } else {
                    resolve();
                }
            });
        })
    );
    gsap.globalTimeline.clear();

    // Remove all objects from the scene
    while (scene.children.length > 0) {
        const obj = scene.children[0];
        scene.remove(obj);

        // Optionally dispose geometry/material for memory
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(mat => mat.dispose());
            } else {
                obj.material.dispose();
            }
        }
    }

    // Re-add camera and lights if you have any
    // scene.add(camera); // not needed, camera is not a child
    // scene.add(light);  // if you use lights

    // Rebuild the cube
    
    cube = new Cube(CUBE_SIZE);
    scene.add(cube.getGroup());
    SHUFFLE_MOVES = [];
}

// --- Play loop state ---
let playing = false;

// Button hooks
const shuffleBtn = document.getElementById('shuffleBtn');
const solveBtn = document.getElementById('solveBtn');
const playBtn = document.getElementById('playBtn');
const resetBtn = document.getElementById('resetBtn');
const shuffleMoves = document.getElementById('shuffleMoves');
const cubeSize = document.getElementById('cubeSize');

shuffleMoves.addEventListener('change', async () => {
    playing = false;
    SHUFFLE_MOVES_COUNT = document.getElementById("shuffleMoves").value;

});

cubeSize.addEventListener('change', async () => {
    playing = false;
    CUBE_SIZE = document.getElementById("cubeSize").value; // 4x4 cube
});

shuffleBtn.addEventListener('click', async () => {
    playing = false; // stop any loop
    await shuffleCube(cube, SHUFFLE_MOVES_COUNT, false); // just shuffle (no solve)
});

solveBtn.addEventListener('click', async () => {
    playing = false; // stop any loop
    await solveCube(cube); // shuffle + solve
});

playBtn.addEventListener('click', async () => {
    if (playing) return;
    playing = true;
    // loop shuffle+solve forever until stopped
    while (playing) {
        await shuffleCube(cube, 1, true);
    }
});



resetBtn.addEventListener('click', async () => {
    playing = false;
    reset();
    
});

// animate & render
function animate() {
    controls.update();
    renderer.render(scene, camera);
}

// (optional) handle resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

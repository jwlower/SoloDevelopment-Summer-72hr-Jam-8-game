import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gsap } from 'gsap';

import { Cube } from './cube.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);

const cube = new Cube(2);
scene.add(cube.getGroup());

camera.position.z = 5;

// OrbitControls for pan and zoom
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

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
            onComplete: () => {
                layerCubelets.forEach(cubelet => {
                    cubelet.mesh.position.applyMatrix4(layerGroup.matrix);
                    cubelet.mesh.rotation.setFromRotationMatrix(layerGroup.matrix);
                    scene.remove(layerGroup);
                    cube.group.add(cubelet.mesh);
                });
                resolve(); // move finished
            }
        });
    });
}

async function shuffleAndSolve(cube, movesCount = 10) {
    const axes = ['x', 'y', 'z'];
    const moves = [];

    // Generate random shuffle moves
    for (let i = 0; i < movesCount; i++) {
        const axis = axes[Math.floor(Math.random() * axes.length)];
        const index = Math.floor(Math.random() * cube.size) - (cube.size - 1) / 2;
        const angle = Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2;
        moves.push({ axis, index, angle });
    }

    // Play shuffle
    for (const move of moves) {
        await rotateLayer(cube, move.axis, move.index, move.angle, 0.8);
    }

    // Play reverse moves (solve)
    for (const move of moves.slice().reverse()) {
        await rotateLayer(cube, move.axis, move.index, -move.angle, 0.8);
    }

    // Repeat
    //shuffleAndSolve(cube, movesCount);
}

shuffleAndSolve(cube, 2); // shuffle 5 random moves, then solve

function animate() {
    controls.update();
    renderer.render(scene, camera);
}
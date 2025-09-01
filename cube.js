import * as THREE from 'three';
import { Cubelet } from './cubelet.js';

export class Cube {
    constructor(size) {
        this.size = size;
        this.cubelets = [];
        this.group = new THREE.Group();
        this.initCubelets();
    }
    initCubelets() {
        const offset = (this.size - 1) / 2;
        const faceColors = [
            0xff0000, // Right - Red
            0x00ff00, // Left - Green
            0x0000ff, // Top - Blue
            0xffff00, // Bottom - Yellow
            0xffa500, // Front - Orange
            0xffffff  // Back - White
        ];
        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                for (let z = 0; z < this.size; z++) {
                    const cubelet = new Cubelet(
                        x - offset,
                        y - offset,
                        z - offset,
                        faceColors
                    );
                    this.cubelets.push(cubelet);
                    this.group.add(cubelet.mesh);
                }
            }
        }
    }
    getGroup() {
        return this.group;
    }
    getLayer(axis, index) {
        // compare on a 0.5 grid: -1.5,-1.0,-0.5,0,0.5,1.0,1.5,...
        const key = Math.round(index * 2);
        return this.cubelets.filter(c =>
            Math.round(c.mesh.position[axis] * 2) === key
        );
        // (Alternatively: Math.abs(c.mesh.position[axis] - index) < 1e-4)
    }
}
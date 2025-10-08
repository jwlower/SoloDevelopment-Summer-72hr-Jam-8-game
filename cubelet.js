import * as THREE from 'three';
export class Cubelet { 
    constructor(x, y, z, faceColors) {
        // Create geometry and materials for each face
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const materials = faceColors.map(color =>
            new THREE.MeshBasicMaterial({ color })
        );
        this.mesh = new THREE.Mesh(geometry, materials);
        this.mesh.position.set(x, y, z);
        

        // Add black border (edges)
        const edgeGeometry = new THREE.EdgesGeometry(geometry);
        const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
        const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        edges.scale.set(1.01, 1.01, 1.01); // Slightly larger than the cube
        this.mesh.add(edges);
    }
}
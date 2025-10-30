import * as THREE from 'three';
export class Cubelet {
    constructor(x, y, z, faceColors) {
        // Create geometry and per-face canvas textures so marks can be painted
        const geometry = new THREE.BoxGeometry(1, 1, 1);

        // per-face canvases / textures / materials
        this.faceCanvases = [];
        this.faceContexts = [];
        this.faceTextures = [];
        this.faceMaterials = [];

        for (let i = 0; i < 6; i++) {
            const size = 128;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');

            // draw background color
            ctx.fillStyle = '#' + faceColors[i].toString(16).padStart(6, '0');
            ctx.fillRect(0, 0, size, size);

            const tex = new THREE.CanvasTexture(canvas);
            tex.needsUpdate = true;

            const mat = new THREE.MeshBasicMaterial({ map: tex });
            // keep original color accessible
            mat.userData = { baseColor: faceColors[i] };

            this.faceCanvases.push(canvas);
            this.faceContexts.push(ctx);
            this.faceTextures.push(tex);
            this.faceMaterials.push(mat);
        }

        this.mesh = new THREE.Mesh(geometry, this.faceMaterials);
        this.mesh.position.set(x, y, z);

        // expose back-reference for raycast handlers
        this.mesh.userData.cubelet = this;

        // --- Add 6 invisible picker planes (one per face) ---
        // Each plane is ~1x1, offset slightly off the surface so the ray hits cleanly.
        const pickerMat = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0.0,     // invisible but still raycastable
            depthTest: true,
            depthWrite: false,
            colorWrite: false // don't write to color buffer
        });
        
        const mkPicker = (w = 0.98, h = 0.98) => new THREE.PlaneGeometry(w, h);
        const offset = 0.505;  // just outside the cubelet face
        const pickers = [];
        
        // Face indices (match your face color order in cube.js):
        // 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z, 5:-Z
        const addPicker = (faceIndex, pos, rot) => {
            const g = mkPicker();
            const m = pickerMat.clone();
            const p = new THREE.Mesh(g, m);
            p.userData = { pickFaceIndex: faceIndex, cubelet: this };
            p.position.set(pos.x, pos.y, pos.z);
            p.rotation.set(rot.x, rot.y, rot.z);
            p.raycast = THREE.Mesh.prototype.raycast; // explicit (clarity)
            this.mesh.add(p);
            pickers.push(p);
        };
        // +X
        addPicker(0, new THREE.Vector3(offset, 0, 0), new THREE.Euler(0, Math.PI / 2, 0));
        // -X
        addPicker(1, new THREE.Vector3(-offset, 0, 0), new THREE.Euler(0, -Math.PI / 2, 0));
        // +Y
        addPicker(2, new THREE.Vector3(0, offset, 0), new THREE.Euler(-Math.PI / 2, 0, 0));
        // -Y
        addPicker(3, new THREE.Vector3(0, -offset, 0), new THREE.Euler(Math.PI / 2, 0, 0));
        // +Z (front)
        addPicker(4, new THREE.Vector3(0, 0, offset), new THREE.Euler(0, 0, 0));
        // -Z (back)
        addPicker(5, new THREE.Vector3(0, 0, -offset), new THREE.Euler(0, Math.PI, 0));

        // Keep a handle if you ever want to toggle pickability
        this._pickerPlanes = pickers;


        // Add black border (edges)
        const edgeGeometry = new THREE.EdgesGeometry(geometry);
        const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
        const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        edges.scale.set(1.01, 1.01, 1.01); // Slightly larger than the cube
        edges.raycast = () => { };
        this.mesh.add(edges);
    }

    // Draw an X or O on one face (faceIndex 0..5), or null to clear
    setFaceMark(faceIndex, mark, options = {}) {
        const ctx = this.faceContexts[faceIndex];
        const canvas = this.faceCanvases[faceIndex];
        const tex = this.faceTextures[faceIndex];
        const size = canvas.width;

        // clear to base color first
        const baseColor = options.baseColor || ('#' + (this.faceMaterials[faceIndex].userData.baseColor).toString(16).padStart(6, '0'));
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = baseColor;
        ctx.fillRect(0, 0, size, size);

        if (mark === 'X' || mark === 'O') {
            ctx.save();
            ctx.translate(size / 2, size / 2);
            ctx.fillStyle = options.color || (mark === 'X' ? '#ff4444' : '#1e88e5');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${Math.floor(size * 0.6)}px sans-serif`;
            ctx.fillText(mark, 0, 6);
            ctx.restore();
        } else if (mark === 'HOVER') {
            // draw subtle border for hover
            ctx.save();
            ctx.strokeStyle = options.color || 'rgba(255,255,255,0.6)';
            ctx.lineWidth = Math.max(3, size * 0.04);
            ctx.strokeRect(size * 0.08, size * 0.08, size * 0.84, size * 0.84);
            ctx.restore();
        }

        tex.needsUpdate = true;
    }

    clearFaceMark(faceIndex) {
        this.setFaceMark(faceIndex, null);
    }

    clearAllMarks() {
        for (let i = 0; i < this.faceCanvases.length; i++) {
            this.setFaceMark(i, null);
        }
    }
}
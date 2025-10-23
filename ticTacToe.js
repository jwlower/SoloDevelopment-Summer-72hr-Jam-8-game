import * as THREE from 'three';

export class TicTacToe {
    constructor(scene, camera, renderer, cube, size = 3) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.cube = cube;
        this.size = size;

        // faces: 0..5 -> each is a size x size array of 'X' | 'O' | null
        this.faces = Array.from({ length: 6 }, () => Array.from({ length: size }, () => Array(size).fill(null)));

        // visual mark storage: maps "face_r_c" -> sprite
        this.marks = new Map();

        this.currentPlayer = 'X';
        this.scores = { X: 0, O: 0 };

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        this.enabled = false;

        // score DOM
        this.scoreEl = this._createScoreDom();
        this.onMarkPlaced = null; // optional callback
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    }

    // Bind pointer handler with proper `this`
    get _onPointerDown() {
        return (e) => {
            if (!this.enabled) return;
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const intersects = this.raycaster.intersectObjects(this.cube.group.children, true);
            if (!intersects.length) return;

            // find the actual cubelet mesh (top-most ancestor that is a cubelet mesh)
            const it = intersects[0];
            const mesh = it.object; // cubelet mesh
            const faceNormal = it.face.normal.clone(); // local normal
            // convert to world normal
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
            faceNormal.applyMatrix3(normalMatrix).normalize();

            const hitPos = mesh.position.clone(); // local cubelet position in world? .position is in parent group space
            // Determine which face index (0..5): use the dominant normal
            const nx = Math.round(faceNormal.x);
            const ny = Math.round(faceNormal.y);
            const nz = Math.round(faceNormal.z);

            const faceIndex = this._normalToFaceIndex(nx, ny, nz);
            if (faceIndex === null) return;

            // compute grid coordinates (row,col) 0..size-1 from mesh.position (cubelet centered positions)
            const grid = this._cubeletPosToGrid(mesh.position, faceIndex);
            if (!grid) return;
            const { r, c } = grid;

            // place mark if empty
            if (this.faces[faceIndex][r][c] == null) {
                this._placeMarkVisual(faceIndex, r, c, this.currentPlayer, mesh, nx, ny, nz);
                this.faces[faceIndex][r][c] = this.currentPlayer;
                if (this.onMarkPlaced) this.onMarkPlaced({ face: faceIndex, r, c, player: this.currentPlayer });
            }
        };
    }

    // convert dominant integer normal to face index 0..5: +X, -X, +Y, -Y, +Z, -Z
    _normalToFaceIndex(nx, ny, nz) {
        if (nx === 1) return 0; // +X
        if (nx === -1) return 1; // -X
        if (ny === 1) return 2; // +Y
        if (ny === -1) return 3; // -Y
        if (nz === 1) return 4; // +Z
        if (nz === -1) return 5; // -Z
        return null;
    }

    // map a cubelet position (Vector3 in cube.group coordinates) and face -> (r,c)
    _cubeletPosToGrid(pos, faceIndex) {
        // cubelet positions are centered at integer or half-integer depending on size
        const s = this.size;
        const half = (s - 1) / 2;
        // mesh.position.x/y/z are numbers like -1,0,1 for size=3
        // map to 0..s-1 based on face orientation
        // For each face, choose the two axes that define the face grid and map to r/c
        let ax1, ax2, invertR = false, invertC = false;
        switch (faceIndex) {
            case 0: // +X  grid axes: z (cols), y (rows)
                ax1 = 'z'; ax2 = 'y'; invertR = true; break;
            case 1: // -X
                ax1 = 'z'; ax2 = 'y'; break;
            case 2: // +Y
                ax1 = 'x'; ax2 = 'z'; break;
            case 3: // -Y
                ax1 = 'x'; ax2 = 'z'; invertR = true; break;
            case 4: // +Z
                ax1 = 'x'; ax2 = 'y'; invertR = false; invertC = false; break;
            case 5: // -Z
                ax1 = 'x'; ax2 = 'y'; invertR = true; invertC = true; break;
            default:
                return null;
        }

        const val1 = pos[ax1]; // -half..half
        const val2 = pos[ax2];

        let c = Math.round(val1 + half);
        let r = Math.round(half - val2); // y usually goes up, rows top->bottom

        if (invertR) r = (this.size - 1) - r;
        if (invertC) c = (this.size - 1) - c;

        if (r < 0 || r >= this.size || c < 0 || c >= this.size) return null;
        return { r, c };
    }

    _placeMarkVisual(face, r, c, player, cubeletMesh, nx, ny, nz) {
        const key = `${face}_${r}_${c}`;
        if (this.marks.has(key)) return;

        const sprite = this._makeTextSprite(player === 'X' ? 'X' : 'O', player === 'X' ? '#ff4444' : '#1e88e5');
        // position sprite slightly above the face center
        // compute face center in world space: cubelet mesh position + normal * 0.51
        const worldPos = new THREE.Vector3().copy(cubeletMesh.position).applyMatrix4(this.cube.group.matrixWorld);
        const normalWorld = new THREE.Vector3(nx, ny, nz);
        const spritePos = worldPos.clone().add(normalWorld.multiplyScalar(0.51));
        sprite.position.copy(spritePos);
        // orient sprite to face camera
        sprite.lookAt(this.camera.position);
        this.scene.add(sprite);
        this.marks.set(key, sprite);
    }

    _makeTextSprite(text, color = '#fff') {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, size, size);
        ctx.font = 'bold 96px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(text, size / 2, size / 2 + 6);

        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(0.6, 0.6, 1);
        return sprite;
    }

    // called after GO step's rotation completes to count completed lines now visible
    evaluateRound() {
        const lines = this._countAllLines();
        // add to scores
        this.scores.X += lines.X;
        this.scores.O += lines.O;
        this._updateScoreDom();
        // toggle player for next placement
        this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
        return lines;
    }

    _countAllLines() {
        const res = { X: 0, O: 0 };
        for (let f = 0; f < 6; f++) {
            const board = this.faces[f];
            // rows
            for (let r = 0; r < this.size; r++) {
                const v = board[r][0];
                if (v && board[r].every(c => c === v)) res[v]++;
            }
            // cols
            for (let c = 0; c < this.size; c++) {
                const v = board[0][c];
                if (v) {
                    let ok = true;
                    for (let r = 0; r < this.size; r++) if (board[r][c] !== v) { ok = false; break; }
                    if (ok) res[v]++;
                }
            }
            // diag TL->BR
            let v1 = board[0][0];
            if (v1) {
                let ok = true;
                for (let i = 0; i < this.size; i++) if (board[i][i] !== v1) { ok = false; break; }
                if (ok) res[v1]++;
            }
            // diag TR->BL
            let v2 = board[0][this.size - 1];
            if (v2) {
                let ok = true;
                for (let i = 0; i < this.size; i++) if (board[i][this.size - 1 - i] !== v2) { ok = false; break; }
                if (ok) res[v2]++;
            }
        }
        return res;
    }

    // returns true if all spaces filled
    isFull() {
        for (let f = 0; f < 6; f++) {
            for (let r = 0; r < this.size; r++) {
                for (let c = 0; c < this.size; c++) {
                    if (!this.faces[f][r][c]) return false;
                }
            }
        }
        return true;
    }

    clearAll() {
        // clear data and visuals
        this.faces = Array.from({ length: 6 }, () => Array.from({ length: this.size }, () => Array(this.size).fill(null)));
        for (const s of this.marks.values()) this.scene.remove(s);
        this.marks.clear();
        this.scores = { X: 0, O: 0 };
        this.currentPlayer = 'X';
        this._updateScoreDom();
    }

    _createScoreDom() {
        const el = document.createElement('div');
        el.className = 'ttt-scores';
        el.innerHTML = `<span>X: <strong id="xScore">0</strong></span> <span style="margin-left:8px">O: <strong id="oScore">0</strong></span>`;
        // add into HUD if present
        const hud = document.getElementById('gameHud');
        if (hud) hud.appendChild(el);
        this.xScoreEl = el.querySelector('#xScore');
        this.oScoreEl = el.querySelector('#oScore');
        return el;
    }

    _updateScoreDom() {
        if (this.xScoreEl) this.xScoreEl.textContent = String(this.scores.X);
        if (this.oScoreEl) this.oScoreEl.textContent = String(this.scores.O);
    }
}
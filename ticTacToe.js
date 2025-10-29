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

        this.currentPlayer = 'X';
        this.scores = { X: 0, O: 0 };

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        this.enabled = false;
        this._hoverKey = null;

        // DOM
        this.scoreEl = this._createScoreDom();
        this._turnEl = document.getElementById('turnIndicator');
        this._updateTurnIndicator = () => {
            if (this._turnEl) this._turnEl.textContent = `${this.currentPlayer}'s Turn`;
        };
        this._updateTurnIndicator();
        // whenever you toggle players:
        this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
        this._updateTurnIndicator();

        // also call when you enable placement so it s fresh:
        this._updateTurnIndicator();

        // bind handlers so .removeEventListener works
        this._boundPointerMove = (e) => this._onPointerMove(e);
        this._boundKeyDown = (e) => this._onKeyDown(e);
        // Remember last hover target for space-commit
        this._hoverTarget = null;

        // load saved state if any
        this.loadState();
    }

    // compatibility aliases (main.js may call enable()/disable())
    enable() { this.enablePlacement(); }
    disable() { this.disablePlacement(); }

    enablePlacement() {
        if (this.enabled) return;
        this.enabled = true;
        this.renderer.domElement.addEventListener('pointermove', this._boundPointerMove);
        window.addEventListener('keydown', this._boundKeyDown);
        this._updateTurnIndicator();
    }

    disablePlacement() {
        if (!this.enabled) return;
        this.enabled = false;
        this.renderer.domElement.removeEventListener('pointermove', this._boundPointerMove);
        window.removeEventListener('keydown', this._boundKeyDown);
        this._clearHover();
        this._hoverTarget = null;
    }

    _findCubeletAncestor(obj) {
        // walk up until we find the mesh that has userData.cubelet
        let mesh = obj;
        while (mesh && !(mesh.material && Array.isArray(mesh.material) && mesh.userData && mesh.userData.cubelet)) {
            mesh = mesh.parent;
        }
        return mesh || null;
    }

    _updateTurnIndicator() {
        if (this._turnEl) {
            this._turnEl.textContent = `${this.currentPlayer}'s Turn`;
        }
    }

    _computeFaceNormalFromIntersection(it, mesh) {
        // prefer intersection face normal if available, otherwise use vector from cubelet center -> hit point
        if (it.face && it.face.normal) {
            const faceNormal = it.face.normal.clone();
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
            faceNormal.applyMatrix3(normalMatrix).normalize();
            return faceNormal;
        }
        // fallback: intersection point relative to cubelet center
        if (it.point) {
            const worldCenter = new THREE.Vector3();
            mesh.getWorldPosition(worldCenter);
            const n = it.point.clone().sub(worldCenter).normalize();
            // snap to dominant axis to avoid small floats
            const nx = Math.round(n.x);
            const ny = Math.round(n.y);
            const nz = Math.round(n.z);
            return new THREE.Vector3(nx, ny, nz);
        }
        return null;
    }

    _onPointerMove(e) {
        if (!this.enabled) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);

        const intersects = this.raycaster.intersectObjects(this.cube.group.children, true);
        if (!intersects.length) {
            this._clearHover();
            return;
        }

        const it = intersects[0];

        // find cubelet mesh ancestor before trying to access face/normal
        const mesh = this._findCubeletAncestor(it.object);
        if (!mesh) { this._clearHover(); return; }

        const faceNormal = this._computeFaceNormalFromIntersection(it, mesh);
        if (!faceNormal) { this._clearHover(); return; }

        // camera-facing check to reduce jitter (require face roughly facing camera)
        if (it.point) {
            const viewDir = this.camera.position.clone().sub(it.point).normalize();
            if (faceNormal.dot(viewDir) < 0.6) { this._clearHover(); return; }
        }

        // UV edge margin: if ray hit is too close to the face border, ignore (reduces seam flicker)
        if (it.face && it.uv) {
            const u = it.uv.x, v = it.uv.y;
            const margin = 0.10; // 10% away from edges
            if (u < margin || u > 1 - margin || v < margin || v > 1 - margin) {
                this._clearHover();
                return;
            }
        }

        const nx = Math.round(faceNormal.x), ny = Math.round(faceNormal.y), nz = Math.round(faceNormal.z);
        const faceIndex = this._normalToFaceIndex(nx, ny, nz);
        if (faceIndex === null) { this._clearHover(); return; }

        const cubelet = mesh.userData.cubelet;
        const grid = this._cubeletPosToGrid(mesh.position, faceIndex);
        if (!grid) { this._clearHover(); return; }
        const { r, c } = grid;

        if (this.faces[faceIndex][r][c] != null) {
            this._clearHover();
            return; // already occupied
        }

        const key = `${cubelet.mesh.id}_${faceIndex}_${r}_${c}`;
        if (this._hoverKey === key) return; // same hover
        this._clearHover();
        this._hoverKey = key;
        this._hoverTarget = { cubelet, faceIndex, r, c };
        // Gray tile + preview glyph for the *current* player
        // baseColor tints the square; color controls the glyph
        cubelet.setFaceMark(
            faceIndex,
            this.currentPlayer,                   // 'X' or 'O'
            { baseColor: '#b5b5b5', color: 'rgba(0,0,0,0.75)' }
        );
    }

    _clearHover() {
        if (!this._hoverKey || !this._hoverTarget) return;
        const { cubelet, faceIndex, r, c } = this._hoverTarget;

        // Only clear if the slot is still empty
        if (!this.faces || this.faces[faceIndex][r][c] == null) {
            cubelet.setFaceMark(faceIndex, null);   // restores original face color
        }

        this._hoverKey = null;
        this._hoverTarget = null;
    }

    _onKeyDown(e) {
        if (!this.enabled) return;
        if (e.code !== 'Space') return;
        e.preventDefault();
        const t = this._hoverTarget;
        if (!t) return;
        const { cubelet, faceIndex, r, c } = t;
        if (this.faces[faceIndex][r][c] != null) return;

        // Clear hover first so the placed mark isn't tinted
        this._clearHover();
        this._hoverTarget = null;

        // Place the mark (solid black)
        cubelet.setFaceMark(faceIndex, this.currentPlayer, { color: '#000' });
        this.faces[faceIndex][r][c] = this.currentPlayer;

        // Alternate player
        this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
        this._updateTurnIndicator();
        this.saveState();
        if (this.isFull()) this.disablePlacement();
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
        const s = this.size;
        const half = (s - 1) / 2;
        let ax1, ax2, invertR = false, invertC = false;
        switch (faceIndex) {
            case 0: ax1 = 'z'; ax2 = 'y'; invertR = true; break; // +X
            case 1: ax1 = 'z'; ax2 = 'y'; break;                 // -X
            case 2: ax1 = 'x'; ax2 = 'z'; break;                 // +Y
            case 3: ax1 = 'x'; ax2 = 'z'; invertR = true; break; // -Y
            case 4: ax1 = 'x'; ax2 = 'y'; break;                 // +Z
            case 5: ax1 = 'x'; ax2 = 'y'; invertR = true; invertC = true; break; // -Z
            default: return null;
        }

        const val1 = pos[ax1];
        const val2 = pos[ax2];

        let c = Math.round(val1 + half);
        let r = Math.round(half - val2);

        if (invertR) r = (this.size - 1) - r;
        if (invertC) c = (this.size - 1) - c;

        if (r < 0 || r >= this.size || c < 0 || c >= this.size) return null;
        return { r, c };
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
        this.saveState();
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
        this.faces = Array.from({ length: 6 }, () => Array.from({ length: this.size }, () => Array(this.size).fill(null)));
        // clear visuals on cubelets
        for (const mesh of this.cube.group.children) {
            if (mesh.userData && mesh.userData.cubelet) mesh.userData.cubelet.clearAllMarks();
        }
        this.scores = { X: 0, O: 0 };
        this.currentPlayer = 'X';
        this._updateScoreDom();
        try { localStorage.removeItem('rubik_ttt_state'); } catch (e) { }
    }

    /* Persist / restore */
    saveState() {
        try {
            const payload = {
                faces: this.faces,
                currentPlayer: this.currentPlayer,
                scores: this.scores,
                size: this.size
            };
            localStorage.setItem('rubik_ttt_state', JSON.stringify(payload));
        } catch (e) { /* ignore */ }
    }

    loadState() {
        try {
            const raw = localStorage.getItem('rubik_ttt_state');
            if (!raw) return;
            const obj = JSON.parse(raw);
            if (!obj || obj.size !== this.size) return;
            this.faces = obj.faces || this.faces;
            this.currentPlayer = obj.currentPlayer || this.currentPlayer;
            this.scores = obj.scores || this.scores;
            // repaint all stored marks onto cubelets
            setTimeout(() => { // graphql: allow cubelets to exist
                for (const mesh of this.cube.group.children) {
                    if (!(mesh.userData && mesh.userData.cubelet)) continue;
                    const cubelet = mesh.userData.cubelet;
                    // for each face index 0..5, compute grid and paint if present
                    for (let f = 0; f < 6; f++) {
                        const grid = this._cubeletPosToGrid(mesh.position, f);
                        if (!grid) {
                            cubelet.clearFaceMark(f);
                            continue;
                        }
                        const val = this.faces[f][grid.r][grid.c];
                        cubelet.setFaceMark(f, val);
                    }
                }
                this._updateScoreDom();
            }, 0);
        } catch (e) { /* ignore */ }
    }

    _createScoreDom() {
        const hud = document.getElementById('gameHud');
        if (!hud) return null;

        // Reuse existing scoreboard if present (prevents duplicates across sessions)
        let el = hud.querySelector('.ttt-scores');
        if (!el) {
            el = document.createElement('div');
            el.className = 'ttt-scores';
            el.innerHTML = `
              <span>X: <strong id="xScore">0</strong></span>
              <span style="margin-left:8px">O: <strong id="oScore">0</strong></span>
              <button id="tttSave" style="margin-left:8px">Save</button>
              <button id="tttLoad" style="margin-left:4px">Load</button>
              <button id="tttClear" style="margin-left:8px">Clear</button>`;
            hud.appendChild(el);
            // Wire up buttons once
            el.querySelector('#tttSave').addEventListener('click', () => this.saveState());
            el.querySelector('#tttLoad').addEventListener('click', () => { this.loadState(); });
            el.querySelector('#tttClear').addEventListener('click', () => { this.clearAll(); });
        }
        // Always refresh references (they may point to reused DOM)
        this.xScoreEl = el.querySelector('#xScore');
        this.oScoreEl = el.querySelector('#oScore');
        return el;
    }

    _updateScoreDom() {
        if (this.xScoreEl) this.xScoreEl.textContent = String(this.scores.X);
        if (this.oScoreEl) this.oScoreEl.textContent = String(this.scores.O);
    }
}
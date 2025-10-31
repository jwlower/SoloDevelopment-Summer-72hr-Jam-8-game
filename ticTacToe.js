import * as THREE from 'three';

export class TicTacToe {
    /* =========================================================================
       Constructor and Initialization
       ========================================================================= */
    constructor(scene, camera, renderer, cube, size = 3) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.cube = cube;
        this.size = size;

        // Input guards (main.js will override via setInputGuards)
        this._guards = {
            isRotating: () => false,
            gamePhase: () => 'pre',
            hasShuffled: () => false,
        };

        // Game state
        this.faces = Array.from({ length: 6 }, () => Array.from({ length: size }, () => Array(size).fill(null)));
        this.currentPlayer = 'X';
        this.scores = { X: 0, O: 0 };
        // overlay lines live here so we can wipe/redraw each recompute
        this._lineGroup = new THREE.Group();
        this._lineGroup.name = 'score-lines';
        this._lineGroup.renderOrder = 999;
        this.cube.group.add(this._lineGroup);

        this.onPlaced = null;

        // Raycasting and input
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.enabled = false;
        this._hoverKey = null;
        this._hoverTarget = null;

        // DOM/UI
        this.xScoreEl = document.getElementById('xScore');
        this.oScoreEl = document.getElementById('oScore');
        this._turnEl = document.getElementById('turnIndicator');
        this._updateTurnIndicator();

        // Bind event handlers
        this._boundPointerMove = (e) => this._onPointerMove(e);
        this._boundKeyDown = (e) => this._onKeyDown(e);

        // Load saved state if any
        this.loadState();
    }

    /* =========================================================================
       Public Methods
       ========================================================================= */
    enable() { this.enablePlacement(); }
    disable() { this.disablePlacement(); }

    clearScoreLines() {
        while (this._lineGroup.children.length) {
            const child = this._lineGroup.children.pop();
            child.geometry?.dispose?.();
            child.material?.dispose?.();
        }
    }

    enablePlacement() {
        if (this.enabled) return;
        this.enabled = true;

        // Add event listeners
        window.addEventListener('keydown', this._boundKeyDown);
        this.renderer.domElement.addEventListener('pointermove', this._boundPointerMove, { passive: true });
        this.renderer.domElement.addEventListener('pointerleave', () => this._clearHover(), { passive: true });

        this.renderer.domElement.style.cursor = 'crosshair';
        this._updateTurnIndicator();
    }

    disablePlacement() {
        if (!this.enabled) return;
        this.enabled = false;

        // Remove event listeners
        window.removeEventListener('keydown', this._boundKeyDown);
        this.renderer.domElement.removeEventListener('pointermove', this._boundPointerMove);
        this.renderer.domElement.style.cursor = 'default';

        this._clearHover();
        this._hoverTarget = null;
    }

    setInputGuards({ isRotating, gamePhase, hasShuffled }) {
        if (isRotating) this._guards.isRotating = isRotating;
        if (gamePhase) this._guards.gamePhase = gamePhase;
        if (hasShuffled) this._guards.hasShuffled = hasShuffled;
    }

    clearAll() {
        this.faces = Array.from({ length: 6 }, () => Array.from({ length: this.size }, () => Array(this.size).fill(null)));
        for (const mesh of this.cube.group.children) {
            if (mesh.userData && mesh.userData.cubelet) mesh.userData.cubelet.clearAllMarks();
        }
        this.scores = { X: 0, O: 0 };
        this.currentPlayer = 'X';
        this._updateScoreDom();
        try { localStorage.removeItem('rubik_ttt_state'); } catch (e) { /* ignore */ }
    }

    syncFromCubelets() {
        this.faces = Array.from({ length: 6 }, () => Array.from({ length: this.size }, () => Array(this.size).fill(null)));
        for (const mesh of this.cube.group.children) {
            if (!(mesh.userData && mesh.userData.cubelet)) continue;
            const cubelet = mesh.userData.cubelet;
            for (let f = 0; f < 6; f++) {
                const grid = this._cubeletPosToGrid(mesh.position, f);
                if (!grid) continue;
                const localIdx = this._localFaceIndexForGlobal(f, mesh);
                const mark = typeof cubelet.getFaceMark === 'function' ? cubelet.getFaceMark(localIdx) : null;
                this.faces[f][grid.r][grid.c] = (mark === 'X' || mark === 'O') ? mark : null;
            }
        }
        this.saveState();
    }

    /* =========================================================================
       Input Handling
       ========================================================================= */
    _onPointerMove(e) {
        if (!this.enabled) return;
        if (!this._guards.hasShuffled() || this._guards.isRotating()) {
            this._clearHover();
            return;
        }

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);

        const hits = this.raycaster.intersectObject(this.cube.group, true);
        const pick = hits.find(h => h.object && h.object.userData && typeof h.object.userData.pickFaceIndex === 'number');
        if (!pick) { this._clearHover(); return; }

        const faceIndex = pick.object.userData.pickFaceIndex;
        const cubelet = pick.object.userData.cubelet;
        const mesh = cubelet && cubelet.mesh;
        if (!mesh) { this._clearHover(); return; }

        const grid = this._cubeletPosToGrid(mesh.position, faceIndex);
        if (!grid) { this._clearHover(); return; }
        const { r, c } = grid;

        if (this.faces[faceIndex][r][c] != null) {
            this._clearHover();
            return;
        }

        const key = `${cubelet.mesh.id}_${faceIndex}_${r}_${c}`;
        if (this._hoverKey === key) return;
        this._clearHover();
        this._hoverKey = key;
        this._hoverTarget = { cubelet, faceIndex, r, c };

        cubelet.setFaceMark(faceIndex, 'HOVER', { color: 'rgba(0,0,0,0.85)' });
    }

    _onKeyDown(e) {
        if (!this.enabled) return;
        if (!this._guards.hasShuffled() || this._guards.isRotating()) return;

        if (e.code === 'Space') {
            e.preventDefault();
            if (this._hoverTarget) {
                const { cubelet, faceIndex, r, c } = this._hoverTarget;
                this._clearHover();
                this._commitTarget(faceIndex, r, c, cubelet);
            }
        }
    }

    _clearHover() {
        if (!this._hoverKey || !this._hoverTarget) return;
        const { cubelet, faceIndex, r, c } = this._hoverTarget;
        const visual = (typeof cubelet.getFaceMark === 'function') ? cubelet.getFaceMark(faceIndex) : null;
        const logicalEmpty = !this.faces || this.faces[faceIndex][r][c] == null;
        const visuallyEmpty = (visual !== 'X' && visual !== 'O');
        if (logicalEmpty && visuallyEmpty) {
            cubelet.setFaceMark(faceIndex, null);
        }
        this._hoverKey = null;
        this._hoverTarget = null;
    }

    _commitTarget(faceIndex, r, c, cubelet) {
        if (this.faces[faceIndex][r][c] != null) return;
        cubelet.setFaceMark(faceIndex, this.currentPlayer, { color: '#000' });
        this.faces[faceIndex][r][c] = this.currentPlayer;
        this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
        this._updateTurnIndicator();
        this.saveState();
        this.disablePlacement();
        if (typeof this.onPlaced === 'function') {
            this.onPlaced();
        } else if (!this.isFull()) {
            // Fallback: if no hook is attached (e.g., not in game mode), allow next move.
            this.enablePlacement();
        }
    }

    /* =========================================================================
       Game Logic
       ========================================================================= */
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

    evaluateRound() {
        return this.recomputeScores();
    }

    scoreThisRotationAndDraw() {
        const result = this._countAllLines(); // { X, O, lines }

        // snapshot before
        const beforeX = this.scores.X, beforeO = this.scores.O;

        // compound scoring: add (even if repeated compared to a previous rotation)
        this.scores.X += result.X;
        this.scores.O += result.O;
        this._updateScoreDom();

        // DEBUG: pretty console log for this rotation
        try {
            const header = 'Scored this rotation +X:${result.X}, +O:${result.O}  (Totals: X ${beforeX} ${this.scores.X}, O ${beforeO} ${this.scores.O})';
            console.groupCollapsed(header);
            // Group scoring lines by face
            const byFace = new Map();
            for (const L of result.lines) {
                const arr = byFace.get(L.face) || [];
                arr.push(L);
                byFace.set(L.face, arr);
            }
            for (const [face, arr] of byFace.entries()) {
                console.group('Face ${face}');
                for (const { type, idx, player } of arr) {
                    console.log("${player} line: ${type}${type.startsWith('D') ? '' : idx}");
                }
                console.groupEnd();
            }
            console.groupEnd();
        } catch { }

        // draw only this rotation’s scoring lines
        this._redrawScoreLines(result.lines);
        this.saveState();
        return result;
    }


    _localFaceIndexForGlobal(globalFace, mesh) {
        // local normals in object space for indices 0..5: +X, -X, +Y, -Y, +Z, -Z
        const locals = [
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(-1, 0, 0),
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, -1, 0),
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(0, 0, -1),
            new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
            new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
            new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
        ];
        const globals = [
            new THREE.Vector3(1, 0, 0), // +X
            new THREE.Vector3(-1, 0, 0), // -X
            new THREE.Vector3(0, 1, 0), // +Y
            new THREE.Vector3(0, -1, 0), // -Y
            new THREE.Vector3(0, 0, 1), // +Z
            new THREE.Vector3(0, 0, -1), // -Z
            new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
            new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
            new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
        ];

        // rotate each local normal into world space
        // local normals (object space)
        
        const q = mesh.getWorldQuaternion(new THREE.Quaternion());
        const target = globals[globalFace];
        let bestIdx = 0, bestDot = -Infinity;
        for (let i = 0; i < 6; i++) {
            const w = locals[i].clone().applyQuaternion(q);
            const dot = w.dot(target);
            if (dot > bestDot) { bestDot = dot; bestIdx = i; }
        }
        return bestIdx;
    }

    /** Remove old overlays and draw new ones for each completed line. */
    _redrawScoreLines(lines) {
        this.clearScoreLines();

        const colorFor = (p) => p === 'X' ? 0xff4444 : 0x1e88e5;
        const N = this.size;

        // World-space normals for the 6 global faces
        const faceNormalWS = (face) => {
            switch (face) {
                case 0: return new THREE.Vector3(1, 0, 0); // +X
                case 1: return new THREE.Vector3(-1, 0, 0); // -X
                case 2: return new THREE.Vector3(0, 1, 0); // +Y
                case 3: return new THREE.Vector3(0, -1, 0); // -Y
                case 4: return new THREE.Vector3(0, 0, 1); // +Z
                case 5: return new THREE.Vector3(0, 0, -1); // -Z
            }
        };

        // Endpoints from grid, then push them out along the *face* normal
        const endFromRC = (face, r, c) => {
            const cl = this._gridToCubelet(face, r, c);
            if (!cl || !cl.mesh) return null;
            const p = cl.mesh.position.clone();
            const n = faceNormalWS(face);
            // 0.5 = face center of the cubelet; +epsilon to "float" above the sticker
            const faceOffset = 0.52;
            return p.addScaledVector(n, faceOffset);
        };

        const makeEnds = (face, type, idx) => {
            if (type === 'R') return [endFromRC(face, idx, 0), endFromRC(face, idx, N - 1)];
            if (type === 'C') return [endFromRC(face, 0, idx), endFromRC(face, N - 1, idx)];
            if (type === 'D0') return [endFromRC(face, 0, 0), endFromRC(face, N - 1, N - 1)];
            if (type === 'D1') return [endFromRC(face, 0, N - 1), endFromRC(face, N - 1, 0)];
            return [null, null];
        };

        for (const { face, type, idx, player } of lines) {
            const [a, b] = makeEnds(face, type, idx);
            if (!a || !b) continue;

            const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
            const mat = new THREE.LineBasicMaterial({
                color: colorFor(player),
                transparent: true,
                opacity: 0.98,
                depthTest: false,   // render on top
                depthWrite: false
            });
            const line = new THREE.Line(geom, mat);
            line.renderOrder = 999;     // extra insurance to draw last
            this._lineGroup.add(line);
        }
    }

    /** Positions grid r,c -> cubelet for the given face */
    _gridToCubelet(faceIndex, r, c) {
        const half = (this.size - 1) / 2;
        const coord = (i) => -half + i;
        let x, y, z;
        switch (faceIndex) {
            case 0: x = half; y = coord(this.size - 1 - r); z = coord(c); break;                 // +X
            case 1: x = -half; y = coord(this.size - 1 - r); z = coord(this.size - 1 - c); break; // -X
            case 2: y = half; x = coord(c); z = coord(this.size - 1 - r); break;                 // +Y
            case 3: y = -half; x = coord(c); z = coord(r); break;                                  // -Y
            case 4: z = half; x = coord(c); y = coord(this.size - 1 - r); break;                  // +Z
            case 5: z = -half; x = coord(this.size - 1 - c); y = coord(this.size - 1 - r); break;  // -Z
            default: return null;
        }
        const mesh = this.cube.group.children.find(m =>
            Math.abs(m.position.x - x) < 1e-4 &&
            Math.abs(m.position.y - y) < 1e-4 &&
            Math.abs(m.position.z - z) < 1e-4
        );
        return mesh && mesh.userData ? mesh.userData.cubelet : null;
    }

    recomputeScores() {
        const totals = this._countAllLines();   // should return {X, O, lines: [...]}
        this.scores.X = totals.X;
        this.scores.O = totals.O;
        this._updateScoreDom();
        if (totals.lines) this._redrawScoreLines(totals.lines);
        this.saveState();
        return totals;
    }

    _countAllLines() {
        const N = this.size;
        const res = { X: 0, O: 0, lines: [] };
        const winner = (arr) => {
            const first = arr[0]; if (!first) return null;
            for (let i = 1; i < arr.length; i++) if (arr[i] !== first) return null;
            return first; // 'X' or 'O'
        };
        for (let f = 0; f < 6; f++) {
            const B = this.faces[f];
            // rows
            for (let r = 0; r < N; r++) {
                const w = winner(Array.from({ length: N }, (_, c) => B[r][c]));
                if (w) { res[w]++; res.lines.push({ face: f, type: 'R', idx: r, player: w }); }
            }
            // cols
            for (let c = 0; c < N; c++) {
                const w = winner(Array.from({ length: N }, (_, r) => B[r][c]));
                if (w) { res[w]++; res.lines.push({ face: f, type: 'C', idx: c, player: w }); }
            }
            // main diag: (0,0)->(N-1,N-1)
            {
                const w = winner(Array.from({ length: N }, (_, i) => B[i][i]));
                if (w) { res[w]++; res.lines.push({ face: f, type: 'D0', idx: 0, player: w }); }
            }
            // anti diag: (0,N-1)->(N-1,0)
            {
                const w = winner(Array.from({ length: N }, (_, i) => B[i][N - 1 - i]));
                if (w) { res[w]++; res.lines.push({ face: f, type: 'D1', idx: 1, player: w }); }
            }
        }
        return res;
    }


    /* =========================================================================
       Utility Methods
       ========================================================================= */
    _updateTurnIndicator() {
        if (this._turnEl) this._turnEl.textContent = `${this.currentPlayer}'s Turn`;
    }

    _cubeletPosToGrid(pos, faceIndex) {
        const s = this.size;
        const half = (s - 1) / 2;
        let ax1, ax2, invertR = false, invertC = false;
        switch (faceIndex) {
            case 0: ax1 = 'z'; ax2 = 'y'; invertR = true; break;
            case 1: ax1 = 'z'; ax2 = 'y'; break;
            case 2: ax1 = 'x'; ax2 = 'z'; break;
            case 3: ax1 = 'x'; ax2 = 'z'; invertR = true; break;
            case 4: ax1 = 'x'; ax2 = 'y'; break;
            case 5: ax1 = 'x'; ax2 = 'y'; invertR = true; invertC = true; break;
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

    saveState() {
        try {
            const payload = {
                faces: this.faces,
                currentPlayer: this.currentPlayer,
                scores: this.scores,
                size: this.size,
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
            setTimeout(() => {
                for (const mesh of this.cube.group.children) {
                    if (!(mesh.userData && mesh.userData.cubelet)) continue;
                    const cubelet = mesh.userData.cubelet;
                    for (let f = 0; f < 6; f++) {
                        const grid = this._cubeletPosToGrid(mesh.position, f);
                        if (!grid) { cubelet.clearFaceMark(f); continue; }
                        const val = this.faces[f][grid.r][grid.c];
                        cubelet.setFaceMark(f, val);
                    }
                }
                this._updateScoreDom();
            }, 0);
        } catch (e) { /* ignore */ }
    }

    _updateScoreDom() {
        if (this.xScoreEl) this.xScoreEl.textContent = String(this.scores.X);
        if (this.oScoreEl) this.oScoreEl.textContent = String(this.scores.O);
    }
}
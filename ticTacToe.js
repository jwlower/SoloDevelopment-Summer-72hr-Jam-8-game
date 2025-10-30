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

        // Selection state for keyboard navigation
        this.selFace = null;   // 0..5
        this.selR = 0;         // 0..size-1
        this.selC = 0;         // 0..size-1
        this._selKey = null;   // cache which cubelet face we’ve painted
        this._guards = { isRotating: () => false, gamePhase: () => 'pre', hasShuffled: () => false };
    
        // keyboard binding (we’ll keep Space to place; Arrows to move)
        this._boundKeyDown = (e) => this._onKeyDown(e);

        // DOM
        this.scoreEl = this._createScoreDom();
        this._turnEl = document.getElementById('turnIndicator');
        this._updateTurnIndicator = () => { if (this._turnEl) this._turnEl.textContent = `${this.currentPlayer}'s Turn`; };
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

      /** Main can inject guards so we only allow input when valid */
      setInputGuards({ isRotating, gamePhase, hasShuffled }) {
        if (isRotating) this._guards.isRotating = isRotating;
        if (gamePhase) this._guards.gamePhase = gamePhase;
        if (hasShuffled) this._guards.hasShuffled = hasShuffled;
      }

      /** Determine which cube face is most front-facing to the camera */
      _activeFaceByCamera() {
        const camDir = this.camera.position.clone().normalize();
        // Dominant axis (/-X, /-Y, /-Z)
            const ax = Math.abs(camDir.x), ay = Math.abs(camDir.y), az = Math.abs(camDir.z);
        if (ax >= ay && ax >= az) return camDir.x >= 0 ? 4 /* Z Front? see map below */ : 5;
        if (ay >= ax && ay >= az) return camDir.y >= 0 ? 2 : 3;
        return camDir.z >= ax && camDir.z >= ay ? 4 : 5;
      }

      /** Explicit face mapping (based on your face color order in cube.js)
   *  0: Right X (Red), 1: Left -X (Green), 2: Top Y (Blue),
   *  3: Bottom -Y (Yellow), 4: Front Z (Orange), 5: Back -Z (White)
   */
      _faceFromNormal(nx, ny, nz) {
        if (nx === 1) return 0;
        if (nx === -1) return 1;
        if (ny === 1) return 2;
        if (ny === -1) return 3;
        if (nz === 1) return 4;
        if (nz === -1) return 5;
        return null;
      }

      /** Positions grid r,c -> find the cubelet mesh for a given face */
      _gridToCubelet(faceIndex, r, c) {
        const half = (this.size - 1) / 2;
        const coord = (i) => -half + i; // 0..size-1 -> -half..half
        let x, y, z;
        switch (faceIndex) {
      case 0: x = half; y = coord(this.size - 1 - r); z = coord(c); break; // X
          case 1: x = -half; y = coord(this.size - 1 - r); z = coord(this.size - 1 - c); break; // -X
          case 2: y = half; x = coord(c); z = coord(this.size - 1 - r); break; // Y
          case 3: y = -half; x = coord(c); z = coord(r); break;                // -Y
          case 4: z = half; x = coord(c); y = coord(this.size - 1 - r); break; // Z (Front)
          case 5: z = -half; x = coord(this.size - 1 - c); y = coord(this.size - 1 - r); break; // -Z (Back)
          default: return null;
        }
    // find mesh at (x,y,z)
        const mesh = this.cube.group.children.find(m =>
              Math.abs(m.position.x - x) < 1e-4 &&
              Math.abs(m.position.y - y) < 1e-4 &&
              Math.abs(m.position.z - z) < 1e-4
            );
    return mesh && mesh.userData ? mesh.userData.cubelet : null;
  }

      _clearSelection() {
        if (!this._selKey) return;
        const [meshId, faceIndex] = this._selKey.split('_');
        const mesh = this.cube.group.children.find(m => String(m.id) === meshId);
        if (mesh && mesh.userData && mesh.userData.cubelet) {
              const cubelet = mesh.userData.cubelet;
              const r = this.selR, c = this.selC;
              const val = this.faces[faceIndex][r][c];
              cubelet.setFaceMark(faceIndex, val); // restore tile to placed mark or base color
            }
        this._selKey = null;
      }

      _paintSelection() {
        if (this.selFace == null) return;
        const cubelet = this._gridToCubelet(this.selFace, this.selR, this.selC);
        if (!cubelet) return;
        this._clearSelection();
        this._selKey = `${cubelet.mesh.id}_${this.selFace}`;
        // gray base  semi-opaque preview glyph for the current player
        cubelet.setFaceMark(this.selFace, 'HOVER'); // thin border, no glyph
      }

      _ensureSelection() {
        if (this.selFace == null) {
              // choose front-facing face  center tile
                  const face = this._activeFaceByCamera();
              this.selFace = (face != null ? face : 4);
              this.selR = Math.floor(this.size / 2);
              this.selC = Math.floor(this.size / 2);
            }
        this._paintSelection();
      }



    // compatibility aliases (main.js may call enable()/disable())
    enable() { this.enablePlacement(); }
    disable() { this.disablePlacement(); }

    enablePlacement() {
        if (this.enabled) return;
        this.enabled = true;

        // keyboard only
        window.addEventListener('keydown', this._boundKeyDown);
        // NEW: track hover on the WebGL canvas (does not conflict with OrbitControls drag)
        this.renderer.domElement.addEventListener('pointermove', this._boundPointerMove, { passive: true });

        this._boundPointerLeave = () => this._clearHover();
        this.renderer.domElement.addEventListener('pointerleave', this._boundPointerLeave, { passive: true });

        this.renderer.domElement.style.cursor = 'crosshair';

        if (this.keyboardMode) this._ensureSelection(); // only if arrows were used
        this._updateTurnIndicator();
    }

    disablePlacement() {
        if (!this.enabled) return;
        this.enabled = false;
        window.removeEventListener('keydown', this._boundKeyDown);
        this.renderer.domElement.removeEventListener('pointermove', this._boundPointerMove);
        if (this._boundPointerLeave) this.renderer.domElement.removeEventListener('pointerleave', this._boundPointerLeave);
        this.renderer.domElement.style.cursor = 'default';
        this._clearHover();
        this._clearSelection();
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
        // Also bail when not in solving phase or while rotating
        if (!this._guards.hasShuffled() || this._guards.gamePhase() !== 'solving' || this._guards.isRotating()) {
            this._clearHover();
            return;
        }
        // If user moves the mouse, leave keyboard mode and drop its selection paint
        if (this.keyboardMode) {
            this.keyboardMode = false;
            this._clearSelection();
        }

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);

        // Intersect the entire cube hierarchy; then pick the first hit on a picker plane
        const hits = this.raycaster.intersectObject(this.cube.group, true);
        const pick = hits.find(
            h => h.object && h.object.userData && typeof h.object.userData.pickFaceIndex === 'number'
        );
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
        this.keyboardMode = false; 
    }

    _commitTarget(faceIndex, r, c, cubelet) {
        if (this.faces[faceIndex][r][c] != null) return;
        // If not provided, resolve the cubelet from grid -> cubelet mapping
        if (!cubelet) cubelet = this._gridToCubelet(faceIndex, r, c);
        if (!cubelet) return;
        this._clearSelection(); // remove preview overlay if present
        cubelet.setFaceMark(faceIndex, this.currentPlayer, { color: '#000' }); // solid glyph
        this.faces[faceIndex][r][c] = this.currentPlayer;
        this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
        this._updateTurnIndicator();
        this.saveState();
        if (!this.isFull()) {
            if (this.keyboardMode) this._ensureSelection();
            } else {
            this.disablePlacement();
        }
    }

    _onKeyDown(e) {
        if (!this.enabled) return;
        // guards: only after shuffled, in 'solving' phase, and not rotating
        if (!this._guards.hasShuffled() || this._guards.gamePhase() !== 'solving' || this._guards.isRotating()) return;
        
        // Update active face on any arrow press (based on camera)
        const faceFromCam = this._activeFaceByCamera();
        if (faceFromCam != null && faceFromCam !== this.selFace) {
            this.selFace = faceFromCam;
        }
        
            const before = { face: this.selFace, r: this.selR, c: this.selC };
        let moved = false;
        
        
        if (e.code === 'Space') {
            e.preventDefault();
            // Prefer committing the HOVER target so we can hover space
            if (this._hoverTarget) {
                const { cubelet, faceIndex, r, c } = this._hoverTarget;
                this._clearHover();         // remove hover preview
                this._clearSelection();     // just in case a stale keyboard selection exists
                this._commitTarget(faceIndex, r, c, cubelet);
                return;
            }
            // Fallback to keyboard selection if no hover
            if (this.faces[this.selFace][this.selR][this.selC] != null) return;
            this._commitTarget(this.selFace, this.selR, this.selC);
        }
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
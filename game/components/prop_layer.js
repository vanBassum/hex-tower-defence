import { Component } from '../../engine/gameobject.js';
import { hashHex } from '../../engine/hex/hex_noise.js';
import { buildProp } from '../props.js';

// Places a level's decoration: hand-authored props at named hexes, plus sparse
// scattered types spread by hash across whatever tiles are allowed.
//
// Props are purely visual - they do not block building or affect targeting - so
// this component owns nothing but meshes. Each one sits on its tile's surface,
// which is why it needs the ground component rather than assuming y = 0.
export class PropLayer extends Component {
  constructor({ grid, assets, ground = null, props = [], scatter = [], includes = null }) {
    super();
    this._grid = grid;
    this._assets = assets;
    this._ground = ground;
    this._props = props;
    this._scatter = scatter;
    this._includes = includes;
  }

  _topY(q, r) { return this._ground ? this._ground.topY(q, r) : 0; }

  _place(typeKey, q, r, index) {
    const { x, z } = this._grid.hexToWorld(q, r);
    const obj = buildProp(this._assets, typeKey, q, r, { x, z, y: this._topY(q, r), index });
    if (!obj) { this.missing++; return; }
    this.gameObject.object3D.add(obj);
    this.count++;
  }

  start() {
    this.count = 0;
    this.missing = 0;
    this.placed = 0;
    this.scattered = 0;

    for (const p of this._props) {
      this._place(p.type, p.q, p.r, 0);
      this.placed++;
    }

    // Each scatter entry gets its own salt, so two types never land on exactly
    // the same set of tiles.
    this._scatter.forEach((entry, i) => {
      const salt = 307 + i * 37;
      for (const { q, r } of this._grid.allHexes()) {
        if (this._includes && !this._includes(q, r)) continue;
        if (hashHex(q, r, salt) >= entry.chance) continue;
        const n = entry.perTile ?? 1;
        for (let k = 0; k < n; k++) this._place(entry.type, q, r, k + 1);
        this.scattered++;
      }
    });
  }

  // Geometry and materials are owned by the asset cache and shared across
  // clones, so nothing is disposed here - only the instances are dropped.
  destroy() {
    this.gameObject.object3D.clear();
  }
}

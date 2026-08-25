import { Component } from '../../engine/gameobject.js';
import { buildProp, createPropMaterials } from '../props.js';

// Places a level's decoration. Props are purely visual - they do not block
// building or affect targeting - so this component owns nothing but meshes.
//
// Each prop sits on its tile's surface, which is why it needs the ground
// component rather than assuming y = 0.
export class PropLayer extends Component {
  constructor({ grid, ground = null, props = [] }) {
    super();
    this._grid = grid;
    this._ground = ground;
    this._props = props;
  }

  start() {
    this._mats = createPropMaterials();
    this.count = 0;

    for (const placement of this._props) {
      const { x, z } = this._grid.hexToWorld(placement.q, placement.r);
      const y = this._ground ? this._ground.topY(placement.q, placement.r) : 0;
      this.gameObject.object3D.add(buildProp(placement, this._mats, { x, z, y }));
      this.count++;
    }
  }

  destroy() {
    this.gameObject.object3D.traverse((o) => o.isMesh && o.geometry.dispose());
    if (this._mats) for (const m of Object.values(this._mats)) m.dispose();
  }
}

import * as THREE from 'three';
import { buildProp, createPropMaterials } from '../game/props.js';
import { UNIT_TYPES } from '../game/units.js';
import { MOOD } from '../game/mood.js';

// Pictures of the assets, rendered from the assets.
//
// The palette used to be words, and words are the wrong control for a list of
// shapes: "Spire" and "Broadleaf" are two trees you can tell apart instantly by
// looking and not at all by reading. So every asset button gets a render of the
// real thing - built by the game's own builders, out of the game's own palette,
// so a tree that changes shape in props.js changes shape here with no second
// version of it to keep in step. Nothing is drawn by hand and nothing is
// screenshotted.
//
// ── It is a photograph, not a view ──────────────────────────────────────────
// Each asset is rendered once, turned into a PNG data URL and cached. After that
// the palette is `<img>` tags: no scene, no render loop, no GPU work at all when
// a category is opened again. That is the whole performance story, and it is why
// this is a function returning a string rather than a component drawing every
// frame - forty live previews at sixty frames a second to look at a list is not a
// trade anybody would make.
//
// The renderer is built when a batch needs it and torn down when the batch ends.
// A category is a batch, so the cost is one short-lived WebGL context per category
// the first time it is opened, and none ever again. Keeping a second context alive
// for the session would be a fixed cost paid for nothing once every picture has
// been taken.
//
// ── The studio, not the island ──────────────────────────────────────────────
// The preview scene is deliberately *not* the game's. The board is a dusk island
// with fog, an environment map and one low sun, which is exactly right for the
// game and useless for a 26-pixel icon: everything comes out nearly black. So
// this is a photographer's setup - bright, neutral, two lights and no fog - and
// the only thing borrowed from the world is the materials, because the colour is
// what makes a rock a rock.

const SIZE = 96;              // rendered pixels, square. Drawn much smaller.
const FOV = 30;               // long lens: less perspective distortion on a tiny image
const PAD = 1.08;             // a little air around the model, so nothing touches the edge

// Where the camera stands, as a direction, per kind of asset. The default is the
// three-quarter view every asset list has ever used, because it shows a
// silhouette and a bit of the top at once.
//
// The two overrides are the only ones, and both are about the same thing: how
// flat the subject is. A body of men is a wide disc of short figures and a tile is
// a surface, so one wants a lower eye - to give the men some height on screen -
// and the other wants a higher one, because a tile seen edge-on is a line.
const EYES = {
  prop: new THREE.Vector3(0.55, 0.5, 1).normalize(),
  unit: new THREE.Vector3(0.32, 0.26, 1).normalize(),
  terrain: new THREE.Vector3(0.42, 0.66, 1).normalize(),
};

// id -> data URL, or null for something that could not be drawn. Lives as long as
// the page: an asset's picture cannot change while the editor is open.
const cache = new Map();

// Complaints, once each. A palette that logs on every repaint is a palette that
// hides the one real problem in a thousand copies of it.
const moaned = new Set();

let studio = null;

// A picture of one asset, or null if it could not be drawn. `preview` is what the
// asset says about itself - see the categories in content.js - and the kind in it
// is the only thing this file switches on.
//
// Deliberately not exported. Every way in from outside is a batch, so every way in
// packs the studio away again when it is done - one entry point that left a WebGL
// context standing would be a leak nobody would notice.
function thumbnail(preview) {
  if (!preview) return null;
  const key = keyOf(preview);
  if (cache.has(key)) return cache.get(key);

  let url = null;
  try {
    url = render(preview);
  } catch (e) {
    if (!moaned.has(key)) {
      moaned.add(key);
      console.warn(`thumbnail: could not draw ${key}`, e);
    }
  }
  cache.set(key, url);
  return url;
}

// A whole palette at once, which is how the editor asks: one category, opened.
// Everything is drawn in one batch and the studio is packed away afterwards, so
// switching categories does not leave a context per category behind.
export function thumbnails(assets) {
  const out = new Map();
  const missing = assets.some(a => a.preview && !cache.has(keyOf(a.preview)));
  for (const a of assets) out.set(a.id, thumbnail(a.preview));
  // Only when something was actually drawn. A repaint of a palette already in the
  // cache never opens the studio, so it must not be the thing that closes it
  // either - that is what makes reopening a category cost nothing at all.
  if (missing) closeStudio();
  return out;
}

// How many pictures are held and whether the studio is currently standing. Only
// for the console and tools/check.py - the point of the arrangement is that the
// second number is false almost all of the time, and there is otherwise no way to
// see that from outside.
export function thumbnailStats() {
  return { cached: cache.size, failed: moaned.size, studioOpen: !!studio };
}

// For a hard reload of the palette - not needed today, and the counterpart of a
// cache that never expires on its own.
export function forgetThumbnails() {
  cache.clear();
  moaned.clear();
  closeStudio();
}

function keyOf(preview) {
  return `${preview.kind}:${preview.type ?? preview.terrain ?? ''}`;
}

// ── The studio ──────────────────────────────────────────────────────────────

function openStudio() {
  if (studio) return studio;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    // The canvas is read with `toDataURL` straight after rendering, and without
    // this the drawing buffer is allowed to be empty by then. It is the one
    // reason this flag is on: it costs a little and buys the picture existing.
    preserveDrawingBuffer: true,
  });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearAlpha(0);
  // Transparent behind the model, so the button's own surface shows through and a
  // thumbnail sits in the panel rather than on a tile of its own.
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  // Two lights and no environment. Bright and neutral on purpose: the point is
  // the silhouette and the colour, so the key light is nearly white and the fill
  // is strong enough that the shadowed side is still a shape rather than a hole.
  //
  // The numbers are well above anything the game uses, and deliberately: the
  // palette's colours are a dusk palette - a unit is dark navy because the island
  // is - and at gameplay light levels a 46-pixel icon of one is a dark smudge.
  const key = new THREE.DirectionalLight(0xffffff, 3.4);
  key.position.set(0.6, 1.1, 0.9);
  scene.add(key);
  // A fill from the opposite side, so the shadowed half of a silhouette is still
  // a shape. Without it a tree reads as half a tree.
  const fill = new THREE.DirectionalLight(0xcfe0ee, 1.5);
  fill.position.set(-0.9, 0.3, -0.5);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xeaf2f8, 0x6b7684, 2.2));

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);

  // The materials come from the world - a rock has to be the board's grey, or the
  // picture is of a different rock. `createPropMaterials` hands out a fresh set
  // per call, so this is a copy of the palette and not a change to it.
  studio = { renderer, scene, camera, props: createPropMaterials(MOOD.props) };
  return studio;
}

function closeStudio() {
  if (!studio) return;
  for (const m of Object.values(studio.props)) m.dispose();
  studio.renderer.dispose();
  // The context itself, which `dispose` does not always give back. Without it a
  // browser eventually starts dropping the oldest context on the page - and the
  // oldest context on this page is the editor's own board.
  studio.renderer.forceContextLoss?.();
  studio = null;
}

function render(preview) {
  const { renderer, scene, camera } = openStudio();
  const model = build(preview);
  if (!model) return null;

  strip(model);
  scene.add(model);
  frame(model, camera, EYES[preview.kind] ?? EYES.prop);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');

  // Out and gone. Everything in here was built for one picture, and a studio that
  // kept them would grow by a model per asset for the life of the page.
  scene.remove(model);
  drop(model);
  return url;
}

// Centre the model on the origin and back the camera off until the whole of it
// just fits the frame. This is the whole of the automatic framing: a grass tuft
// and a tree both fill their picture, and the only thing that differs between
// them is how far away the camera stands.
//
// It fits the bounding *box in screen space* rather than the bounding sphere, and
// the difference is most of what makes these readable. A sphere around a body of
// fifteen men is as wide as the formation and the men are short, so sphere-fitting
// leaves the subject in a thin band across the middle of an empty picture. Fitting
// the corners is exact: for each one, the distance at which it lands on the edge
// of the frustum is
//
//     d = p·eye + max(|p·right|, |p·up|) / tan(fov/2)
//
// because the camera sits along `eye` looking at the origin, so a point's depth is
// `d - p·eye` and its offset across the frame is its component along the other two
// axes. The furthest-out corner decides, and nothing can then clip.
function frame(model, camera, eye) {
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) throw new Error('the model has no geometry in it');

  const centre = box.getCenter(new THREE.Vector3());
  model.position.sub(centre);
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);

  // The camera's own two cross axes. `up` is derived rather than assumed, because
  // the eye direction is not level.
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), eye).normalize();
  const up = new THREE.Vector3().crossVectors(eye, right).normalize();
  const t = Math.tan((camera.fov * Math.PI) / 360);

  let dist = 0;
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(
      (i & 1 ? 1 : -1) * half.x,
      (i & 2 ? 1 : -1) * half.y,
      (i & 4 ? 1 : -1) * half.z,
    );
    const across = Math.max(Math.abs(corner.dot(right)), Math.abs(corner.dot(up)));
    dist = Math.max(dist, corner.dot(eye) + (across * PAD) / t);
  }

  const reach = half.length();
  camera.position.copy(eye).multiplyScalar(dist);
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(0.005, dist - reach * 2);
  camera.far = dist + reach * 4;
  camera.updateProjectionMatrix();
}

// ── What each kind of asset is made of ──────────────────────────────────────

function build(preview) {
  if (preview.kind === 'prop') return buildPropModel(preview.type);
  if (preview.kind === 'unit') return buildUnitModel(preview.type);
  if (preview.kind === 'terrain') return buildTerrainModel(preview.terrain);
  throw new Error(`unknown preview kind "${preview.kind}"`);
}

// Anything in PROP_TYPES, through the same builder the board uses. `salt` 0 and no
// offset, so the picture is the type rather than one instance of it - and the same
// picture every time, which is the other half of a thumbnail being a photograph.
function buildPropModel(type) {
  const { props } = openStudio();
  const obj = buildProp(
    { type, q: 0, r: 0, salt: 0, dx: 0, dz: 0 }, props, { x: 0, z: 0, y: 0 },
    { lanternLight: MOOD.lanternLight },
  );
  // Built lying on the ground, which is right on a board and wrong in a portrait:
  // framing is about the model, and the model's own base offset is part of it.
  const group = new THREE.Group();
  group.add(obj);
  return group;
}

// A unit is a *formation* - fifteen men in ranks - and that is what gets drawn,
// because it is what the asset is. A single soldier would be a clearer picture of
// something the editor cannot place: what a click puts on the board is the body of
// men, and at this size the shape of the block is exactly what tells a scout from
// a line of swordsmen.
function buildUnitModel(type) {
  const unit = UNIT_TYPES[type];
  if (!unit) throw new Error(`no unit type "${type}"`);
  // The hex size the formation is laid out against. One, as the board uses.
  const model = unit.build(MOOD.units, { hexSize: 1, lamp: LAMPS[type] });
  // The selection ring goes. It is a wide flat disc on the ground and the framing
  // fits the bounding box, so leaving it in would zoom every formation out to fit
  // a ring nobody asked to see - and a portrait of a unit is not a unit that has
  // been clicked on.
  const ring = model.userData.selectionRing;
  if (ring) {
    ring.parent?.remove(ring);
    ring.geometry?.dispose();
    ring.material?.dispose();
  }
  return model;
}

// Which lights belong to which type, the same pair the game names - passed in so
// the figure that carries a lamp is built with one, and `strip` then takes the
// light itself out. The mesh of the lantern is part of the silhouette; the light
// it throws has no business in a studio.
const LAMPS = { king: MOOD.kingFire, scout: MOOD.scoutLamp };

// Terrain is a colour and not a shape, so its picture is a piece of the board:
// one hex prism in that terrain's own tone. Drawing the ground renderer's actual
// mesh would mean a grid, an elevation map and a neighbour pass to find out what
// a single tile looks like, and the answer would still be a hexagon in that
// colour.
const TERRAIN_TONE = {
  land: MOOD.ground.grassColors[MOOD.ground.grassColors.length - 1],
  crag: MOOD.ground.rockColor,
  water: MOOD.water.oceanColor,
};

function buildTerrainModel(terrain) {
  const color = TERRAIN_TONE[terrain];
  if (color === undefined) throw new Error(`no tone for terrain "${terrain}"`);
  const group = new THREE.Group();
  // Flat-top, like the board's own tiles, and thick enough to show a side: a
  // hexagon seen from above is a colour swatch, and the side is what says this is
  // a piece of ground.
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.34, 6),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  top.rotation.y = Math.PI / 6;
  group.add(top);
  // A crag is rock pushed up through the ground, so its swatch gets a lump on it -
  // otherwise it is the same hexagon as the others in a slightly different grey.
  // The lump is the same stone as the tile, not the cliff brown: two colours here
  // read as a rock with something piled on it rather than as one outcrop.
  if (terrain === 'crag') {
    const lump = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.62, 0),
      new THREE.MeshLambertMaterial({ color, flatShading: true }),
    );
    lump.scale.y = 0.7;
    lump.position.y = 0.3;
    group.add(lump);
  }
  return group;
}

// ── Housekeeping ────────────────────────────────────────────────────────────

// No lights and no shadows in a picture. A unit's lamp or a lantern's flame would
// light the studio - and three bakes the number of point lights into the identity
// of every shader program, so leaving them in would recompile every material in
// here per asset.
function strip(model) {
  const lights = [];
  model.traverse((o) => {
    if (o.isLight) lights.push(o);
    if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
  });
  for (const l of lights) l.parent?.remove(l);
}

// Geometry always, and materials only where they were made for this one model.
// The prop palette is shared across every picture and belongs to the studio; a
// unit's formation and a terrain swatch build their own, and those go.
function drop(model) {
  const shared = new Set(Object.values(studio?.props ?? {}));
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (m && !shared.has(m)) m.dispose();
    }
  });
}

// HOW something is edited, as opposed to what - which is a content category, and
// lives in content.js. A tool is an *interaction* and nothing else: it knows how
// to turn a cursor into a footprint and which verb to ask the content for. It
// does not know that trees exist.
//
// That is the split the whole editor is built on. Five interactions times seven
// categories is forty things the editor can do, and not one of them is
// written down anywhere: the tool contributes the gesture, the category
// contributes the meaning, and the panel offers the combination when the category
// says it makes sense.
//
//   id, name          what it is called
//   hint              one line, shown under the settings
//   icon              inline SVG, 16x16, currentColor
//   color             the preview's colour, so the mode is visible
//   verb              which content verb a press asks for - and `select` has
//                     none, because picking something up changes no level
//   footprint         'hex' for one, 'area' for a radius
//   continuous        true if a drag keeps acting. A continuous tool's verb has
//                     to be idempotent per hex, because the pointer reports every
//                     move and not every new hex - so tools that place a
//                     countable number of things are press-only
//   settings          which of SETTINGS this tool offers, in order

import { MOOD } from '../game/mood.js';

// Every setting in the editor, declared once. A tool says which of them it
// offers and a category says which of them it understands, and a setting is on
// screen when both agree - which is how "brush radius" never appears under a lamp
// and "lamp brightness" never appears under a brush.
//
// Values are held per tool, not per key, and that is deliberate: Place wants a
// stated facing with no variation and Brush wants a free spin, and they are the
// same word meaning the same thing with different right answers. One shared value
// would make choosing one of them wrong.
export const SETTINGS = {
  radius:    { label: 'Radius', min: 1, max: 5, value: 2 },
  density:   { label: 'Density', min: 1, max: 10, value: 3 },
  spacing:   { label: 'Spacing', min: 1, max: 4, value: 1 },
  seed:      { label: 'Seed', min: 0, max: 9, value: 0 },
  size:      { label: 'Size vary', min: 0, max: 3, value: 2 },
  spin:      { label: 'Turn vary', min: 0, max: 2, value: 2 },
  // A compass step of 30 degrees. It only means anything while the variation
  // above is not free, so it is not shown when it would do nothing.
  turn:      { label: 'Facing', min: 0, max: 11, value: 0, when: (st) => st.s.spin !== 2 },
  // Tenths, so the stepper is whole numbers and the scale is not.
  scale:     { label: 'Scale', min: 4, max: 20, value: 10 },
  // Whether troops placed on the board are waiting to be found. A 0/1 stepper
  // rather than a checkbox, because a checkbox is a control this panel does not
  // have and one flag is not a reason to build one.
  dormant:   { label: 'On reveal', min: 0, max: 1, value: 1 },
  step:      { label: 'Height step', min: 1, max: 3, value: 1 },
  height:    { label: 'Height', min: 1, max: 5, value: 3 },
  // What a light opens on is the hour's own lamp rather than a number typed here -
  // see mood.js, which is where every colour and every brightness lives.
  intensity: {
    label: 'Bright', min: 2, max: 40, step: 2, when: lit,
    value: Math.round(MOOD.lanternLight.intensity),
  },
  distance: {
    label: 'Reach', min: 2, max: 18, when: lit,
    value: Math.round(MOOD.lanternLight.distance),
  },
};

// Only for something that carries a light, which the type says and this only
// reads - see `lights` in PROP_TYPES.
function lit(st) {
  return st.assets.some(a => a.lights);
}

const HEX = 'M8 1.2 13.9 4.6 13.9 11.4 8 14.8 2.1 11.4 2.1 4.6Z';

export const TOOLS = [
  {
    id: 'select',
    name: 'Select',
    hint: 'Click to pick what is on a hex, drag to move it. Right-click removes it.',
    color: 0xf0dcc0,
    icon: `<svg viewBox="0 0 16 16"><path d="M3.4 1.9 3.4 12.9 6.4 10.1 8.5 14.3 10.4 13.4 ` +
      `8.3 9.3 12.3 9.3Z" fill="currentColor"/></svg>`,
    // No verb: it changes nothing, so it never reaches a category. What it does is
    // held by the editor - what is picked is something the editor has hold of, not
    // something the level says - and the drag that carries it is there too.
    verb: null,
    footprint: 'hex',
    continuous: true,
    settings: [],
  },

  {
    id: 'place',
    name: 'Place',
    hint: 'Click a spot inside a hex to stand one thing exactly there.',
    color: 0x9fe8b0,
    icon: `<svg viewBox="0 0 16 16"><path d="M8 2.4v11M2.4 8h11" stroke="currentColor" ` +
      `stroke-width="1.1" opacity="0.5"/><circle cx="8" cy="8" r="2.6" fill="currentColor"/></svg>`,
    verb: 'place',
    footprint: 'hex',
    // One press, one thing. A drag would smear a row of them across every hex the
    // cursor crossed, which is what Brush is for and is not what a precise
    // placement means.
    continuous: false,
    // Aligned rather than free by default, because the point of this tool is that
    // what you see under the cursor is what you get - and a ghost that lands at
    // some other angle is a ghost that was lying.
    settings: ['turn', 'spin', 'scale', 'height', 'intensity', 'distance'],
    defaults: { spin: 0 },
  },

  {
    id: 'tile',
    name: 'Tile',
    hint: 'Click one hex. Wheel sculpts height where the content has one.',
    color: 0x9fd8ee,
    icon: `<svg viewBox="0 0 16 16"><path d="${HEX}" fill="currentColor" opacity="0.8"/></svg>`,
    verb: 'tile',
    footprint: 'hex',
    continuous: false,
    settings: ['density', 'seed', 'size', 'spin', 'turn', 'scale', 'step',
      'height', 'intensity', 'distance', 'dormant'],
  },

  {
    id: 'brush',
    name: 'Brush',
    hint: 'Drag to work over an area. Wheel sculpts height where the content has one.',
    color: 0x8fd8a8,
    icon: `<svg viewBox="0 0 16 16"><path d="${HEX}" fill="none" stroke="currentColor" ` +
      `stroke-width="1.1" opacity="0.4"/><circle cx="5.4" cy="6.4" r="1.6" fill="currentColor"/>` +
      `<circle cx="10.6" cy="5.6" r="1.1" fill="currentColor"/>` +
      `<circle cx="8.4" cy="10.2" r="1.9" fill="currentColor"/></svg>`,
    verb: 'brush',
    footprint: 'area',
    continuous: true,
    settings: ['radius', 'density', 'spacing', 'seed', 'size', 'spin', 'turn', 'scale', 'step'],
  },

  {
    id: 'erase',
    name: 'Erase',
    hint: 'Removes only the content category you have chosen, over the footprint.',
    color: 0xe8a09a,
    icon: `<svg viewBox="0 0 16 16"><path d="${HEX}" fill="none" stroke="currentColor" ` +
      `stroke-width="1.3" stroke-dasharray="2.4 2" opacity="0.8"/></svg>`,
    verb: 'erase',
    footprint: 'area',
    continuous: true,
    settings: ['radius'],
  },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map(t => [t.id, t]));

// Each tool's settings at their starting values. Held by the editor rather than on
// the tool, so a tool stays a description of itself and two editors could not end
// up sharing one brush radius.
export function defaultSettings() {
  const out = {};
  for (const tool of TOOLS) {
    out[tool.id] = {};
    for (const key of tool.settings) {
      out[tool.id][key] = tool.defaults?.[key] ?? SETTINGS[key].value ?? SETTINGS[key].min;
    }
  }
  return out;
}

// Which settings are on screen for this tool with this category chosen: the
// tool's own list, narrowed to what the category understands, narrowed again by
// whatever the setting itself says about the current state.
//
// `state` is `{ assets, s }` - what the palette has ticked and the values as they
// stand - because a setting that hides itself is usually hiding because of one or
// the other.
export function visibleSettings(tool, content, state) {
  return tool.settings
    .filter(key => content.settings.includes(key))
    .filter(key => !SETTINGS[key].when || SETTINGS[key].when(state))
    .map(key => ({ key, ...SETTINGS[key] }));
}

// The tools this category supports, in the order the rail shows them. A tool the
// category has no use for is still listed - the panel draws it disabled rather
// than dropping it, because a row of buttons that changes length as you move
// between categories is a row nobody can build a habit on.
export function toolsFor(content) {
  return TOOLS.map(tool => ({ tool, enabled: content.tools.includes(tool.id) }));
}

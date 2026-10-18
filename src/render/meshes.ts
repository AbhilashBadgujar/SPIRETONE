import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  Shape,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYOUT } from './layout';

// Procedural low-poly placeholders for the GDD's 10-mesh budget:
// block, cottage roof, pier, tower cap, lighthouse lamp, plaza tile, bridge,
// island base, ocean (ocean.ts), gull (gulls.ts). Past the budget, for the
// lived-in look: building dressing (doors, trims, chimneys, flower boxes,
// laundry), scenery (plots, tufts, flowers, bushes, trees, rocks) and the
// island's life (boats, villagers and fish, in life.ts).
//
// Every geometry is in column-local space: origin on the surface it stands
// on, +z away from the island center, +x toward the next index. Pieces are
// split by palette slot so each one tints from the era preset.

const W = LAYOUT.blockWidth;
const D = LAYOUT.blockDepth;
const H = LAYOUT.blockHeight;

const PLAZA_HEIGHT = LAYOUT.plazaHeight;
export const TOWER_ROOF_HEIGHT = 0.66;

function merge(...geos: BufferGeometry[]): BufferGeometry {
  const parts = geos.map((g) => {
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat.getAttribute('uv')) flat.deleteAttribute('uv');
    return flat;
  });
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('mergeGeometries failed');
  return merged;
}

// --- block ---------------------------------------------------------------

export function blockGeometry(): BufferGeometry {
  return merge(new RoundedBoxGeometry(W, H, D, 2, 0.05).translate(0, H / 2, 0));
}

const WINDOW = { w: 0.17, h: 0.2, t: 0.03, y: H * 0.55 };

/** `front`: include the outward (+z) window; ground floors put their door there instead. */
export function windowGeometry(front = true): BufferGeometry {
  const { w, h, t, y } = WINDOW;
  const parts = [
    new BoxGeometry(w, h, t).translate(0, y, -D / 2),
    new BoxGeometry(t, h, w).translate(W / 2, y, 0),
    new BoxGeometry(t, h, w).translate(-W / 2, y, 0),
  ];
  if (front) parts.push(new BoxGeometry(w, h, t).translate(0, y, D / 2));
  return merge(...parts);
}

// --- building dressing -------------------------------------------------------

/** Ground-floor door on the outward face. */
export function doorGeometry(): BufferGeometry {
  return merge(new BoxGeometry(0.2, 0.3, 0.03).translate(0, 0.15, D / 2 + 0.005));
}

/** Canvas awning over the door, tipped down and out. */
export function awningGeometry(): BufferGeometry {
  return merge(new BoxGeometry(0.3, 0.025, 0.13).rotateX(0.38).translate(0, 0.35, D / 2 + 0.055));
}

/** Little lantern beside the door (lit eras). */
export function doorLanternGeometry(): BufferGeometry {
  return merge(new BoxGeometry(0.05, 0.075, 0.05).translate(0.17, 0.25, D / 2 + 0.03));
}

/** Band over the joint between two floors, so a stack reads as one building. Origin on the joint. */
export function trimGeometry(): BufferGeometry {
  return merge(new BoxGeometry(W + 0.05, 0.045, D + 0.05));
}

/** Window box under a floor's outward window: blooms first (tinted), then the box. */
export function flowerBloomsGeometry(): BufferGeometry {
  const y = WINDOW.y - WINDOW.h / 2 + 0.005;
  return merge(
    ...[-0.075, -0.025, 0.025, 0.075].map((x, i) =>
      new IcosahedronGeometry(0.03, 0).translate(x, y + (i % 2) * 0.01, D / 2 + 0.045),
    ),
  );
}

export function flowerBoxGeometry(): BufferGeometry {
  return merge(new BoxGeometry(0.23, 0.05, 0.07).translate(0, WINDOW.y - WINDOW.h / 2 - 0.03, D / 2 + 0.04));
}

/** One piece of washing, hung by its top edge (origin) and lying along the bridge. */
export function laundryGeometry(): BufferGeometry {
  return merge(new BoxGeometry(0.012, 0.11, 0.09).translate(0, -0.055, 0));
}

// --- scenery -----------------------------------------------------------------

/** Soft round patch marking an empty, droppable column (replaces the old square tile). */
export function plotGeometry(): BufferGeometry {
  return merge(new CylinderGeometry(0.3, 0.33, 0.02, 12).translate(0, 0.01, 0));
}

/** Three blades of grass. */
export function tuftGeometry(): BufferGeometry {
  return merge(
    new ConeGeometry(0.022, 0.13, 3).translate(0, 0.065, 0),
    new ConeGeometry(0.02, 0.1, 3).rotateZ(0.35).translate(0.03, 0.045, 0.01),
    new ConeGeometry(0.02, 0.09, 3).rotateX(-0.4).translate(-0.01, 0.04, -0.03),
  );
}

export function bloomGeometry(): BufferGeometry {
  return merge(new IcosahedronGeometry(0.032, 0).translate(0, 0.1, 0));
}

export function stemGeometry(): BufferGeometry {
  return merge(new CylinderGeometry(0.008, 0.008, 0.09, 3).translate(0, 0.045, 0));
}

export function bushGeometry(): BufferGeometry {
  return merge(
    new IcosahedronGeometry(0.17, 0).scale(1, 0.75, 1).translate(0, 0.1, 0),
    new IcosahedronGeometry(0.11, 0).translate(0.1, 0.07, 0.06),
  );
}

/** Round tree: canopy first (tinted), then trunk. */
export function treeCanopyGeometry(): BufferGeometry {
  return merge(
    new IcosahedronGeometry(0.22, 0).translate(0, 0.44, 0),
    new IcosahedronGeometry(0.15, 0).translate(0.1, 0.58, 0.05),
  );
}

export function treeTrunkGeometry(): BufferGeometry {
  return merge(new CylinderGeometry(0.035, 0.05, 0.32, 5).translate(0, 0.16, 0));
}

/** Pine (or cypress, scaled thin): stacked cones, then a short trunk. */
export function pineCanopyGeometry(): BufferGeometry {
  return merge(
    new ConeGeometry(0.2, 0.3, 6).translate(0, 0.28, 0),
    new ConeGeometry(0.15, 0.26, 6).translate(0, 0.45, 0),
    new ConeGeometry(0.1, 0.22, 6).translate(0, 0.6, 0),
  );
}

export function pineTrunkGeometry(): BufferGeometry {
  return merge(new CylinderGeometry(0.03, 0.04, 0.16, 5).translate(0, 0.08, 0));
}

export function boulderGeometry(): BufferGeometry {
  return merge(new DodecahedronGeometry(0.12, 0).scale(1, 0.6, 0.85).translate(0, 0.035, 0));
}

// --- cottage roof ----------------------------------------------------------

/** Chimney through the cottage roof's inner slope. Its top is CHIMNEY_TOP. */
export const CHIMNEY_TOP = { x: 0.2, y: 0.47, z: -0.13 };

export function chimneyGeometry(): BufferGeometry {
  const { x, y, z } = CHIMNEY_TOP;
  return merge(
    new BoxGeometry(0.1, 0.3, 0.1).translate(x, y - 0.15, z),
    new BoxGeometry(0.13, 0.04, 0.13).translate(x, y - 0.02, z),
  );
}

export function cottageRoofGeometry(): BufferGeometry {
  const span = D + 0.16;
  const rise = 0.42;
  const length = W + 0.12;
  const s = new Shape();
  s.moveTo(-span / 2, 0);
  s.lineTo(span / 2, 0);
  s.lineTo(0, rise);
  s.closePath();
  // Extrude along z, then turn so the ridge runs tangentially.
  const g = new ExtrudeGeometry(s, { depth: length, bevelEnabled: false });
  g.translate(0, 0, -length / 2).rotateY(Math.PI / 2);
  return merge(g);
}

// --- tower cap -----------------------------------------------------------

export function towerRoofGeometry(): BufferGeometry {
  return merge(
    new ConeGeometry(0.57, TOWER_ROOF_HEIGHT, 4, 1).rotateY(Math.PI / 4).translate(0, TOWER_ROOF_HEIGHT / 2, 0),
  );
}

export function flagGeometry(): BufferGeometry {
  const poleBase = TOWER_ROOF_HEIGHT - 0.05;
  const poleLen = 0.42;
  return merge(
    new CylinderGeometry(0.018, 0.018, poleLen, 4).translate(0, poleBase + poleLen / 2, 0),
    new BoxGeometry(0.2, 0.12, 0.012).translate(0.11, poleBase + poleLen - 0.08, 0),
  );
}

// --- lighthouse lamp -------------------------------------------------------

export function lampGalleryGeometry(): BufferGeometry {
  return merge(new CylinderGeometry(0.46, 0.42, 0.07, 8).translate(0, 0.035, 0));
}

export function lampGlassGeometry(): BufferGeometry {
  return merge(new CylinderGeometry(0.24, 0.24, 0.32, 8).translate(0, 0.07 + 0.16, 0));
}

export function lampCapGeometry(): BufferGeometry {
  return merge(
    new ConeGeometry(0.33, 0.3, 8).translate(0, 0.39 + 0.15, 0),
    new IcosahedronGeometry(0.05, 0).translate(0, 0.39 + 0.3 + 0.03, 0),
  );
}

// --- pier ------------------------------------------------------------------

export function pierWoodGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const n = 5;
  const pw = 0.3;
  const gap = 0.06;
  const total = n * pw + (n - 1) * gap;
  const start = LAYOUT.pierOffset - total / 2;
  for (let k = 0; k < n; k++) {
    parts.push(new BoxGeometry(0.64, 0.06, pw).translate(0, 0.1, start + pw / 2 + k * (pw + gap)));
  }
  for (const x of [-0.24, 0.24]) {
    parts.push(new BoxGeometry(0.06, 0.06, total).translate(x, 0.05, LAYOUT.pierOffset));
  }
  const postTop = 0.08;
  const postBottom = LAYOUT.waterLevel - 0.35;
  for (const x of [-0.27, 0.27]) {
    for (const z of [LAYOUT.pierOffset + 0.4, LAYOUT.pierOffset + 0.8]) {
      parts.push(
        new CylinderGeometry(0.045, 0.045, postTop - postBottom, 5).translate(x, (postTop + postBottom) / 2, z),
      );
    }
  }
  return merge(...parts);
}

export function pierCargoGeometry(): BufferGeometry {
  const deck = 0.13;
  return merge(
    new BoxGeometry(0.24, 0.24, 0.24).translate(0.14, deck + 0.12, -0.15),
    new BoxGeometry(0.17, 0.17, 0.17).rotateY(0.5).translate(0.15, deck + 0.24 + 0.085, -0.14),
    new CylinderGeometry(0.1, 0.1, 0.24, 7).translate(-0.15, deck + 0.12, 0.02),
  );
}

// --- plaza tile ------------------------------------------------------------

/** Unit footprint; scaled per plaza to span its 2x2 columns. */
export function plazaSlabGeometry(): BufferGeometry {
  return merge(new BoxGeometry(1, PLAZA_HEIGHT, 1).translate(0, PLAZA_HEIGHT / 2, 0));
}

export function fountainStoneGeometry(): BufferGeometry {
  return merge(
    new CylinderGeometry(0.42, 0.48, 0.2, 10).translate(0, 0.1, 0),
    new CylinderGeometry(0.07, 0.09, 0.42, 6).translate(0, 0.2 + 0.21, 0),
    new CylinderGeometry(0.2, 0.08, 0.08, 8).translate(0, 0.62 + 0.04, 0),
  );
}

export function fountainWaterGeometry(): BufferGeometry {
  return merge(
    new CylinderGeometry(0.37, 0.37, 0.02, 10).translate(0, 0.19, 0),
    new CylinderGeometry(0.17, 0.17, 0.02, 8).translate(0, 0.69, 0),
  );
}

// --- bridge ----------------------------------------------------------------

/** Unit length along z; scaled per edge. */
export function bridgeWoodGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [new BoxGeometry(0.32, 0.04, 1)];
  for (const x of [-0.16, 0.16]) {
    for (const z of [-0.42, 0.42]) parts.push(new BoxGeometry(0.035, 0.24, 0.035).translate(x, 0.12, z));
  }
  return merge(...parts);
}

export function bridgeRopeGeometry(): BufferGeometry {
  return merge(
    new BoxGeometry(0.025, 0.025, 1).translate(-0.16, 0.22, 0),
    new BoxGeometry(0.025, 0.025, 1).translate(0.16, 0.22, 0),
  );
}

/**
 * The bridge's cog (GDD §6 gear animation toggle): stands upright on the
 * deck, turning about local x (across the deck). Origin at its hub.
 */
export const GEAR_RADIUS = 0.15;

export function bridgeGearGeometry(): BufferGeometry {
  const t = 0.07;
  const parts: BufferGeometry[] = [
    new CylinderGeometry(GEAR_RADIUS, GEAR_RADIUS, t, 12).rotateZ(Math.PI / 2),
    new CylinderGeometry(0.05, 0.05, t + 0.05, 6).rotateZ(Math.PI / 2),
  ];
  const teeth = 8;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    parts.push(
      new BoxGeometry(t, 0.06, 0.07)
        .translate(0, GEAR_RADIUS + 0.025, 0)
        .rotateX(a),
    );
  }
  return merge(...parts);
}

// --- life (life.ts) ---------------------------------------------------------

/** A villager, about two-fifths of a floor tall: body (clothes) and head (skin). Origin at the feet. */
export function personBodyGeometry(): BufferGeometry {
  return merge(new CylinderGeometry(0.03, 0.046, 0.13, 6).translate(0, 0.065, 0));
}

export function personHeadGeometry(): BufferGeometry {
  return merge(new IcosahedronGeometry(0.037, 0).translate(0, 0.167, 0));
}

/** Held out over the water from a standing villager's hands. */
export function fishingRodGeometry(): BufferGeometry {
  return merge(new CylinderGeometry(0.005, 0.007, 0.5, 3).translate(0, 0.25, 0).rotateX(0.95).translate(0.05, 0.1, 0.03));
}

/** Rowing boat, bow toward -z: painted hull, then the wooden inside and its seat. */
export function boatHullGeometry(): BufferGeometry {
  const s = new Shape();
  s.moveTo(-0.27, 0.1);
  s.lineTo(0.25, 0.1);
  s.lineTo(0.33, 0.15);
  s.lineTo(0.2, -0.03);
  s.lineTo(-0.22, -0.03);
  s.lineTo(-0.3, 0.12);
  s.closePath();
  return merge(new ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false }).translate(0, 0, -0.1).rotateY(Math.PI / 2));
}

export function boatInsideGeometry(): BufferGeometry {
  return merge(
    new BoxGeometry(0.16, 0.012, 0.44).translate(0, 0.101, 0.01),
    new BoxGeometry(0.19, 0.03, 0.05).translate(0, 0.12, 0.06),
  );
}

/** Small fish, nose toward +z. */
export function fishGeometry(): BufferGeometry {
  return merge(
    new OctahedronGeometry(0.07, 0).scale(0.45, 0.65, 1.6),
    new ConeGeometry(0.045, 0.08, 3).rotateX(Math.PI / 2).translate(0, 0, -0.13),
  );
}

export function fireflyGeometry(): BufferGeometry {
  return merge(new OctahedronGeometry(0.038, 0));
}

// --- island base -----------------------------------------------------------

const ROCK_HEIGHT = 1.7;

/** Rock cylinder whose top face (group 1) reads as the sand rim. */
export function rockGeometry(): BufferGeometry {
  const r = LAYOUT.islandRadius;
  const g = new CylinderGeometry(r, r + 0.7, ROCK_HEIGHT, 22, 3).translate(0, -ROCK_HEIGHT / 2, 0);
  // Knock the sides out of round. Hashing by position keeps seam duplicates together.
  const pos = g.getAttribute('position');
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v);
    const y = pos.getY(v);
    const z = pos.getZ(v);
    if (y > -0.01 || Math.hypot(x, z) < 0.1) continue;
    // Seam vertices differ by ~1e-16 (sin 2π vs sin 0), so quantize first.
    const qx = Math.round(x * 1000);
    const qy = Math.round(y * 1000);
    const qz = Math.round(z * 1000);
    const f = 1 + (hash3(qx, qy, qz) - 0.5) * 0.14;
    pos.setXYZ(v, x * f, y + (hash3(qz, qx, qy) - 0.5) * 0.12, z * f);
  }
  g.computeVertexNormals();
  return g;
}

export function grassGeometry(): BufferGeometry {
  const r = LAYOUT.islandRadius - 0.25;
  return merge(new CylinderGeometry(r, r + 0.05, LAYOUT.groundY, 22).translate(0, LAYOUT.groundY / 2, 0));
}

export function moundGeometry(): BufferGeometry {
  return merge(new IcosahedronGeometry(1.2, 1).scale(1, 0.42, 1));
}

export function spireGeometry(): BufferGeometry {
  return merge(new ConeGeometry(0.17, 1.6, 5).translate(0, 0.45 + 0.8, 0));
}

export function spireCrystalGeometry(): BufferGeometry {
  return merge(new OctahedronGeometry(0.15).scale(1, 1.6, 1).translate(0, 0.45 + 1.6 + 0.14, 0));
}

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

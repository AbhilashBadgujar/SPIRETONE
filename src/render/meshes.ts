import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
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
// island base, ocean (ocean.ts), gull (gulls.ts).
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

export function windowGeometry(): BufferGeometry {
  const w = 0.17;
  const h = 0.2;
  const t = 0.03;
  const y = H * 0.55;
  return merge(
    new BoxGeometry(w, h, t).translate(0, y, D / 2),
    new BoxGeometry(w, h, t).translate(0, y, -D / 2),
    new BoxGeometry(t, h, w).translate(W / 2, y, 0),
    new BoxGeometry(t, h, w).translate(-W / 2, y, 0),
  );
}

/** Flat tile marking an empty, droppable column. */
export function markerGeometry(): BufferGeometry {
  return merge(new RoundedBoxGeometry(0.5, 0.025, 0.5, 1, 0.01).translate(0, 0.0125, 0));
}

// --- cottage roof ----------------------------------------------------------

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

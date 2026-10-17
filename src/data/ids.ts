// Stable IDs from the GDD. Used as-is in code, saves and UI lookups.

export type StructureId =
  | 'ST_EMPTY'
  | 'ST_COTTAGE'
  | 'ST_PIER'
  | 'ST_TOWER'
  | 'ST_LIGHTHOUSE'
  | 'ST_PLAZA';

/** GDD §3 structure table, "Name" column. */
export const STRUCTURE_NAMES: Readonly<Record<StructureId, string>> = {
  ST_EMPTY: 'Empty',
  ST_COTTAGE: 'Cottage',
  ST_PIER: 'Pier',
  ST_TOWER: 'Tower',
  ST_LIGHTHOUSE: 'Lighthouse',
  ST_PLAZA: 'Plaza',
};

/** Structure types that count toward Harmony's distinct-type term (GDD §5). */
export const HARMONY_TYPES: readonly StructureId[] = [
  'ST_COTTAGE',
  'ST_PIER',
  'ST_TOWER',
  'ST_LIGHTHOUSE',
  'ST_PLAZA',
];

export type ModifierId =
  | 'MOD_BRIDGE'
  | 'MOD_OVERCLOCK'
  | 'MOD_BALCONY'
  | 'MOD_BEACON'
  | 'MOD_PLAZA_AURA'
  | 'MOD_GOLDEN';

export type EraId = 'ERA_1' | 'ERA_2' | 'ERA_3' | 'ERA_4';

/** Era as an array index into every per-era K_* table: 0 = ERA_1 … 3 = ERA_4. */
export type EraIndex = 0 | 1 | 2 | 3;

export const ERA_IDS: readonly EraId[] = ['ERA_1', 'ERA_2', 'ERA_3', 'ERA_4'];

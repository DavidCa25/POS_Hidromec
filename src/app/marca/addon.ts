/**
 * El addon de este build, o `null` en el Wybix de siempre.
 *
 * `addons.generated.ts` lo escribe `scripts/addons.mjs` antes de cada
 * compilación y no se versiona: así ningún commit puede dejar a todos los
 * clientes con la marca de uno.
 */
import { ADDONS } from './addons.generated';
import type { AddonWybix } from './marca';

export const ADDON: AddonWybix | null = ADDONS[0] ?? null;

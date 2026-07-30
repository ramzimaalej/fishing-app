/**
 * Local-calendar day key, used for anything that resets at local midnight.
 *
 * Lived in the ads module while the only daily counter was an ad frequency cap.
 * It has nothing to do with ads — the fishing-session allowance uses it too —
 * so it sits here now that ads are gone.
 *
 * Built from LOCAL date fields, never via toISOString(): that converts to UTC
 * first, so anyone east or west of Greenwich would roll over on the wrong day
 * for part of every day.
 */
export function dayKeyOf(now: number): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

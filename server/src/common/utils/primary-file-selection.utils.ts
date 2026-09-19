export type PrimaryFileCandidate = {
  id: number;
  format: string | null;
  sizeBytes: number | null;
  mediaOverlayAvailable?: boolean | null;
};

export function selectPrimaryFile<T extends PrimaryFileCandidate>(
  files: readonly T[],
  formatPriority: readonly string[],
  options: {
    allowZeroByteFallback?: boolean;
  } = {},
): T | null {
  if (files.length === 0) return null;

  const nonEmpty = files.filter((file) => (file.sizeBytes ?? 0) > 0);
  const pool = nonEmpty.length > 0 ? nonEmpty : options.allowZeroByteFallback ? [...files] : [];
  if (pool.length === 0) return null;

  const normalizedPriority = formatPriority.map((format) => format.toLowerCase());
  const preferredFormat = normalizedPriority.find((format) => pool.some((file) => file.format?.toLowerCase() === format));
  const formatPool = preferredFormat ? pool.filter((file) => file.format?.toLowerCase() === preferredFormat) : pool;
  const first = formatPool[0] ?? null;
  if (first?.format?.toLowerCase() !== 'epub') return first;

  return formatPool.find((file) => file.mediaOverlayAvailable === true) ?? first;
}

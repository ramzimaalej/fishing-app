/**
 * Filesystem seam for capture.
 *
 * expo-file-system and expo-constants are native modules, absent under Jest and
 * in any build where they are not linked. They are required lazily and behind
 * accessors so that importing the recorder — or the pure modules that sit beside
 * it — never drags a native dependency into a unit test.
 */

type FileSystemModule = typeof import('expo-file-system');

let cached: FileSystemModule | null = null;

function load(): FileSystemModule | null {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('expo-file-system') as FileSystemModule;
    return cached;
  } catch {
    return null;
  }
}

/** The module, or a thrown error the caller reports rather than a silent no-op. */
export function fs(): FileSystemModule {
  const mod = load();
  if (!mod) throw new Error('File storage is unavailable in this build.');
  return mod;
}

export function fsAvailable(): boolean {
  return load() !== null;
}

/** Root directory holding every recording, with a trailing slash. */
export function captureRoot(): string {
  const mod = load();
  const base = mod?.documentDirectory ?? '';
  return `${base}castmate-captures/`;
}

export function recordingDir(id: string): string {
  return `${captureRoot()}${id}/`;
}

/** App version for provenance, so an old recording is not read as current. */
export function appVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants') as typeof import('expo-constants');
    return Constants.default?.expoConfig?.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

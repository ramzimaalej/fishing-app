/**
 * Reading, exporting and deleting recordings on disk.
 *
 * Kept separate from the recorder: the recorder only ever appends to the one
 * active session, while this walks and mutates the whole archive. Mixing them
 * would let a bug in the browser touch a live capture.
 */
import { Platform, Share } from 'react-native';

import type { CaptureMeta, RecordingSummary } from './captureTypes';
import { SAMPLE_CSV_HEADER } from './csv';
import { captureRoot, fs, fsAvailable, recordingDir } from './storage';

const isChunk = (name: string): boolean => /^chunk-\d+\.csv$/.test(name);

async function readMeta(id: string): Promise<CaptureMeta | null> {
  try {
    const raw = await fs().readAsStringAsync(`${recordingDir(id)}meta.json`);
    const parsed = JSON.parse(raw) as CaptureMeta;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

export { readMeta as loadMeta };

async function dirBytes(dir: string, names: readonly string[]): Promise<number> {
  let total = 0;
  for (const name of names) {
    try {
      const info = await fs().getInfoAsync(`${dir}${name}`);
      if (info.exists && !info.isDirectory) total += info.size ?? 0;
    } catch {
      /* a file vanishing mid-listing is not worth failing the whole list for */
    }
  }
  return total;
}

/** Every recording, newest first. Unreadable directories are skipped. */
export async function listRecordings(): Promise<RecordingSummary[]> {
  if (!fsAvailable()) return [];
  const root = captureRoot();

  let ids: string[];
  try {
    const info = await fs().getInfoAsync(root);
    if (!info.exists) return [];
    ids = await fs().readDirectoryAsync(root);
  } catch {
    return [];
  }

  const out: RecordingSummary[] = [];
  for (const id of ids) {
    const meta = await readMeta(id);
    if (!meta) continue;
    const dir = recordingDir(id);
    let names: string[] = [];
    try {
      names = await fs().readDirectoryAsync(dir);
    } catch {
      /* fall through with no files; the summary still lists the metadata */
    }
    out.push({
      id: meta.id,
      label: meta.label,
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
      sampleCount: meta.sampleCount,
      bytes: await dirBytes(dir, names),
      events: meta.events ?? [],
    });
  }

  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Every chunk concatenated into one CSV, header included once.
 *
 * Chunks are sorted by name, which is why they are zero-padded — plain string
 * order would otherwise put chunk-10 before chunk-2 and scramble the timeline.
 */
export async function readAllSamples(id: string): Promise<string> {
  const dir = recordingDir(id);
  const names = (await fs().readDirectoryAsync(dir)).filter(isChunk).sort();

  const parts: string[] = [SAMPLE_CSV_HEADER];
  for (const name of names) {
    const body = await fs().readAsStringAsync(`${dir}${name}`);
    // Drop each chunk's own header line.
    const rows = body.split('\n').slice(1).filter((l) => l.length > 0);
    parts.push(...rows);
  }
  return `${parts.join('\n')}\n`;
}

export async function deleteRecording(id: string): Promise<void> {
  await fs().deleteAsync(recordingDir(id), { idempotent: true });
}

export async function deleteAllRecordings(): Promise<void> {
  await fs().deleteAsync(captureRoot(), { idempotent: true });
}

export interface ExportResult {
  ok: boolean;
  /** Where it went, for confirming to the user. */
  destination?: string;
  error?: string;
}

/**
 * Write a recording out where the user can retrieve it.
 *
 * Android goes through the Storage Access Framework so the files land in a real
 * folder (Downloads, Drive, wherever they pick) rather than the sandbox, which
 * is otherwise only reachable over adb. SAF ships inside expo-file-system, so
 * this needs no extra native module and no rebuild.
 *
 * iOS has no SAF equivalent here and expo-sharing is not a dependency, so it
 * falls back to the share sheet with the metadata file. Android is the platform
 * this tool is actually used on.
 */
export async function exportRecording(id: string): Promise<ExportResult> {
  const meta = await readMeta(id);
  if (!meta) return { ok: false, error: 'Recording metadata is missing.' };

  let samples: string;
  let events: string;
  try {
    samples = await readAllSamples(id);
    events = await fs().readAsStringAsync(`${recordingDir(id)}events.csv`).catch(() => '');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read the recording.' };
  }

  if (Platform.OS !== 'android') {
    try {
      await Share.share({ title: `${id} metadata`, message: JSON.stringify(meta) });
      return { ok: true, destination: 'share sheet' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Share failed.' };
    }
  }

  const SAF = fs().StorageAccessFramework;
  let dirUri: string;
  try {
    const permission = await SAF.requestDirectoryPermissionsAsync();
    if (!permission.granted) return { ok: false, error: 'No folder was chosen.' };
    dirUri = permission.directoryUri;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Folder request failed.' };
  }

  const files: [name: string, mime: string, body: string][] = [
    [`${id}-samples`, 'text/csv', samples],
    [`${id}-meta`, 'application/json', JSON.stringify(meta, null, 2)],
  ];
  // Only when the recording was stopped cleanly; meta.json carries the events regardless.
  if (events) files.push([`${id}-events`, 'text/csv', events]);

  try {
    for (const [name, mime, body] of files) {
      const uri = await SAF.createFileAsync(dirUri, name, mime);
      await fs().writeAsStringAsync(uri, body);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Write failed.' };
  }

  return { ok: true, destination: 'the folder you picked' };
}

/** "1.4 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "1h 04m" / "38s" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

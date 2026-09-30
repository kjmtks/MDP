// Machine-local store for voice recordings (the takes of a voice calibration).
//
// A voice is personal data, so the takes are kept ONLY on this computer — in
// the app's own browser storage (Electron: the user profile folder), never in the
// workspace, where they could be synced, committed or shared with a deck. Each
// take is saved as soon as it is accepted, so closing the window mid-session
// loses nothing; the set stays until the user deletes it (it is also the training
// set for a speaker-inversion voice, see trainingSetFiles).

export interface StoredTake {
  /** What was read (as spoken: math readings, no markers) — the transcript. */
  text: string;
  /** Trimmed, levelled take: 16-bit mono WAV. */
  wav: Uint8Array;
  /** Voiced seconds (for the reading speed). */
  speechSec: number;
}

export interface VoiceRecordingSet {
  id: string;
  /** The voice id it is (or will be) registered under. */
  name: string;
  createdAt: number;
  updatedAt: number;
  sampleRate: number;
  takes: StoredTake[];
  /** Where it was last registered as a reference voice. */
  registered?: { server: string; voiceId: string; at: number };
}

const DB = 'mdp-voice-recordings';
const STORE = 'sets';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This window has no local storage for recordings.')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Local storage for recordings could not be opened.'));
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error || req.error || new Error('Saving the recording failed.'));
      tx.onabort = () => reject(tx.error || new Error('Saving the recording failed (storage full?).'));
    });
  } finally {
    db.close();
  }
}

/** An empty set, to which the first kept take is added. */
export function newRecordingSet(name: string, sampleRate: number): VoiceRecordingSet {
  const now = Date.now();
  return { id: `v${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`, name, createdAt: now, updatedAt: now, sampleRate, takes: [] };
}

/** All saved sets, most recently changed first. */
export async function listRecordingSets(): Promise<VoiceRecordingSet[]> {
  const all = await run<VoiceRecordingSet[]>('readonly', (s) => s.getAll() as IDBRequest<VoiceRecordingSet[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveRecordingSet(set: VoiceRecordingSet): Promise<void> {
  await run('readwrite', (s) => s.put({ ...set, updatedAt: Date.now() }));
}

export async function deleteRecordingSet(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

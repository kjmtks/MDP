// Machine-local copies of the voices MDP registers on TTS servers.
//
// The voice API (Irodori-TTS-Server's, copied by kjai01's Chatterbox) can list,
// add, replace and remove voices but never hands a voice's audio back, and has no
// rename. To rename one (voiceRename.ts) MDP registers the SAME audio under the new
// name and removes the old one — so it keeps a copy of whatever it uploads, here,
// keyed by the server (speechProfileKey) and the voice id. A voice is personal
// data: like the recordings (voiceStore.ts) the copies stay in the app's own
// browser storage on this computer, never in a workspace.

interface VoiceCopy {
  key: string;            // `${server}|${voiceId}`
  server: string;
  voiceId: string;
  wav: Uint8Array;
  at: number;
}

const DB = 'mdp-voice-copies';
const STORE = 'copies';
const keyOf = (server: string, voiceId: string) => `${server}|${voiceId}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This window has no local storage.')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'key' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Local storage could not be opened.'));
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error || req.error || new Error('Local storage failed.'));
      tx.onabort = () => reject(tx.error || new Error('Local storage failed (full?).'));
    });
  } finally {
    db.close();
  }
}

/** Keep the audio just registered as `voiceId` on `server`. */
export async function keepVoiceCopy(server: string, voiceId: string, wav: Uint8Array): Promise<void> {
  const copy: VoiceCopy = { key: keyOf(server, voiceId), server, voiceId, wav: wav.slice(), at: Date.now() };
  await run('readwrite', (s) => s.put(copy));
}

/** The audio MDP registered as `voiceId` on `server`, if it did (null otherwise). */
export async function voiceCopy(server: string, voiceId: string): Promise<Uint8Array | null> {
  const c = await run<VoiceCopy | undefined>('readonly', (s) => s.get(keyOf(server, voiceId)) as IDBRequest<VoiceCopy | undefined>);
  return c?.wav ?? null;
}

/** Forget the copy of a voice that was removed from the server. */
export async function dropVoiceCopy(server: string, voiceId: string): Promise<void> {
  await run('readwrite', (s) => s.delete(keyOf(server, voiceId)));
}

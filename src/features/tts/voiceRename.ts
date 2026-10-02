// Renaming a voice registered on a TTS server. The voice API (Irodori-TTS-Server's,
// copied by kjai01's Chatterbox) has no rename and never gives a voice's audio back,
// so a rename registers the SAME audio under the new name and then removes the old
// one. The audio comes from MDP's copy of what it uploaded (voiceCopyStore), else
// from the recording the voice was made from (voiceStore), else from a file the user
// picks (`audio`) — a voice registered elsewhere, or before MDP kept copies.
import { IRODORI_VOICE_ID, deleteIrodoriVoice, saveIrodoriVoice, speechProfileKey, type SpeechServer } from './ttsService';
import { voiceCopy } from './voiceCopyStore';
import { listRecordingSets, saveRecordingSet } from './voiceStore';
import { buildReference, decodeWav, encodeWav } from './voiceAudio';

export type RenameResult = 'renamed' | 'exists' | 'no-audio';

/** Why `to` cannot be the new name of `from` ('' = it can). */
export function renameProblem(from: string, to: string): string {
  if (!to) return '';
  if (!IRODORI_VOICE_ID.test(to)) return 'letters, digits, - and _';
  if (to.toLowerCase() === 'none') return '“none” means no voice';
  if (to !== from && to.toLowerCase() === from.toLowerCase()) return 'differs only in upper/lower case';
  return '';
}

// The recordings a voice was registered from, on this server.
async function recordingsOf(server: SpeechServer, voiceId: string) {
  const key = speechProfileKey({ url: server.url });
  const sets = await listRecordingSets().catch(() => []);
  return sets.filter((s) => s.registered?.voiceId === voiceId && speechProfileKey({ url: s.registered.server }) === key);
}

/** Rename voice `from` to `to` on `server`. 'exists': `to` is taken (ask, then call
 *  again with `replace`); 'no-audio': MDP has no audio of `from` (call again with a
 *  file's `audio`). Errors (the server refuses, the network) throw. */
export async function renameServerVoice(
  server: SpeechServer, from: string, to: string, opts: { replace?: boolean; audio?: Uint8Array } = {},
): Promise<RenameResult> {
  const problem = renameProblem(from, to);
  if (problem || !to) throw new Error(`“${to}” cannot be a voice name: ${problem || 'empty'}.`);
  if (to === from) return 'renamed';
  let audio = opts.audio ?? await voiceCopy(speechProfileKey(server), from).catch(() => null);
  const sets = await recordingsOf(server, from);
  if (!audio) {
    const set = sets.find((s) => s.takes.length);
    if (set) audio = encodeWav(buildReference(set.takes.map((t) => decodeWav(t.wav))));
  }
  if (!audio) return 'no-audio';
  if (await saveIrodoriVoice(server, to, audio, !!opts.replace) === 'exists') return 'exists';
  try {
    await deleteIrodoriVoice(server, from);
  } catch (e) {
    throw new Error(`Registered as “${to}”, but “${from}” could not be removed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // The recording it was made from now goes by the new name.
  for (const s of sets) {
    await saveRecordingSet({
      ...s, name: s.name === from ? to : s.name, registered: { ...s.registered!, voiceId: to, at: Date.now() },
    }).catch(() => { /* a label only */ });
  }
  return 'renamed';
}

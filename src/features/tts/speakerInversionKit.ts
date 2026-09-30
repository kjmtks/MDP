// What goes into an exported voice-recording ZIP besides the takes: a README
// with the Speaker Inversion recipe for Irodori-TTS, and make_manifest.py, which
// turns the takes into the training manifest.
//
// Why a script of our own instead of Irodori-TTS's prepare_manifest.py: that one
// reads audio through Hugging Face `datasets`, which decodes with torchcodec —
// and torchcodec needs FFmpeg DLLs that a Windows machine usually lacks. Our takes
// are plain 16-bit WAV, so soundfile reads them; the encoding itself is the same
// call prepare_manifest.py makes (normalize_text, DACVAE at −16 dB), and the
// manifest lines have the same fields (text, latent_path, num_frames).
//
// The trained voice is registered as "<name>-si": the server scans voices/ in
// name order and lets <name>.wav (the reference-clip voice) shadow
// <name>.speaker.safetensors, so the two need different ids — which also lets
// the presenter compare them.

import { formatSeconds } from './voiceAudio';
import type { VoiceRecordingSet } from './voiceStore';

export const MAKE_MANIFEST_PY = `r"""Build an Irodori-TTS training manifest from this MDP voice-recording folder.

Run it with the Python of your Irodori-TTS TRAINING checkout (not the server):

    <Irodori-TTS>\\.venv\\Scripts\\python.exe make_manifest.py

It reads metadata.csv + wavs/*.wav next to this file, encodes every take with the
DACVAE codec the way prepare_manifest.py does (normalize_text, loudness -16 dB),
and writes latents/*.pt + manifest.jsonl here. It needs no Hugging Face datasets,
torchcodec or FFmpeg: the WAVs are read with soundfile.
"""
import argparse
import csv
import json
import sys
from pathlib import Path


def main() -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--irodori", help="Irodori-TTS checkout (default: the one whose .venv runs this script)")
    ap.add_argument("--device", help="cuda or cpu (default: cuda when available)")
    ap.add_argument("--codec-repo", default="Aratako/Semantic-DACVAE-Japanese-32dim")
    args = ap.parse_args()

    repo = Path(args.irodori).resolve() if args.irodori else Path(sys.prefix).resolve().parent
    if not (repo / "irodori_tts").is_dir():
        sys.exit(f"No Irodori-TTS checkout at {repo}. Run this with <Irodori-TTS>\\\\.venv\\\\Scripts\\\\python.exe, or pass --irodori <path>.")
    sys.path.insert(0, str(repo))

    import soundfile as sf
    import torch
    from irodori_tts.codec import DACVAECodec
    from irodori_tts.text_normalization import normalize_text

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    codec = DACVAECodec.load(
        repo_id=args.codec_repo, device=device,
        deterministic_encode=True, deterministic_decode=True, normalize_db=-16.0,
    )
    latents = here / "latents"
    latents.mkdir(exist_ok=True)
    with (here / "metadata.csv").open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    written = 0
    seconds = 0.0
    with (here / "manifest.jsonl").open("w", encoding="utf-8", newline="\\n") as out:
        for i, row in enumerate(rows):
            text = normalize_text(row["text"]).strip()
            if not text:
                print(f"skipped (no text): {row['file_name']}")
                continue
            data, sr = sf.read(str(here / row["file_name"]), dtype="float32", always_2d=True)
            wav = torch.from_numpy(data.T.copy())  # (channels, samples)
            with torch.inference_mode():
                latent = codec.encode_waveform(wav, sample_rate=sr)[0].cpu()
            path = latents / f"{i:05d}.pt"
            torch.save(latent, path)
            out.write(json.dumps({
                "text": text,
                "latent_path": path.relative_to(here).as_posix(),
                "num_frames": int(latent.shape[0]),
            }, ensure_ascii=False) + "\\n")
            written += 1
            seconds += data.shape[0] / sr
    print(f"Wrote {here / 'manifest.jsonl'}: {written} takes, {seconds:.0f} s of audio.")


if __name__ == "__main__":
    main()
`;

export function speakerInversionReadme(set: VoiceRecordingSet): string {
  const sec = set.takes.reduce((n, t) => n + t.speechSec, 0);
  const n = set.name;
  return `MDP voice recordings: ${n}
${set.takes.length} sentences, ${formatSeconds(sec)} of speech, recorded ${new Date(set.createdAt).toLocaleString()}.

This is a real person's voice. Keep it private: not in a shared, synced or
public folder.

Contents
  wavs/*.wav         the takes (16-bit mono PCM, ${set.sampleRate} Hz, trimmed and levelled)
  metadata.csv       file_name,text: what each take says (a Hugging Face "audiofolder")
  make_manifest.py   turns them into an Irodori-TTS training manifest


Train a Speaker Inversion voice for Irodori-TTS (v4 / v4.1 Small)
------------------------------------------------------------------
The model stays frozen; only 16 "speaker tokens" are learned from these takes.
More speech gives a steadier voice: a few minutes is a good aim (MDP: Record
my voice -> Record more). You need a checkout of the Irodori-TTS TRAINING
repository (github.com/Aratako/Irodori-TTS, set up with "uv sync"), which is
not the same as the Irodori-TTS-Server.

1. Unzip this folder and, inside it, encode the takes (writes manifest.jsonl
   and latents/ here):

     <Irodori-TTS>\\.venv\\Scripts\\python.exe make_manifest.py

2. Train, from the Irodori-TTS checkout, against the SAME model the TTS server
   runs (IRODORI_HF_CHECKPOINT in the server's .env):

     cd <Irodori-TTS>
     uv run train.py --config configs/train_v4_small_speaker_inversion.yaml --manifest "<this folder>\\manifest.jsonl" --init-checkpoint "<model.safetensors of that model>" --output-dir outputs\\speaker_inversion\\${n}

   Downloaded models are in the Hugging Face cache, e.g.
     C:\\Users\\<you>\\.cache\\huggingface\\hub\\models--Aratako--Irodori-TTS-v4.1-Small\\snapshots\\<hash>\\model.safetensors
   Training needs the GPU: stop the TTS server first if memory is short.

3. Copy outputs\\speaker_inversion\\${n}\\checkpoint_final.speaker.safetensors into
   the server's voices\\ folder as

     ${n}-si.speaker.safetensors

   then press Connect in MDP and pick the voice "${n}-si". (Keep the "-si":
   a ${n}.wav voice in the same folder would take the name ${n} over.)
`;
}

// The voice models (ADR 0152): what to download, from where, and the hash each file must have. Every file is pinned:
// Hugging Face files by revision + sha256 of the content (Git LFS) or the git blob id (small text files, no LFS);
// GitHub release archives of k2-fsa/sherpa-onnx by the sha256 GitHub publishes for the asset. A file whose hash differs
// is deleted and never loaded. Used by main/voice/worker.ts (download) and service.ts (state); pinned by
// test/unit/voice-catalog.test.ts.
import type { VoiceAsr, VoiceName } from '@shared/voice';

/** One file to fetch. check: sha256 of the bytes, or sha1 of the git blob ("blob <size>\0" + bytes). untar: a .tar.bz2
 *  unpacked into the part's folder (its top folder dropped). */
export interface VoiceFile { name: string; url: string; check: { sha256: string } | { gitBlob: string; size: number }; bytes: number; untar?: boolean }
export interface VoicePart { id: string; files: VoiceFile[] }

const HF = (repo: string, rev: string, file: string) => `https://huggingface.co/${repo}/resolve/${rev}/${file}`;
const GH = (tag: string, file: string) => `https://github.com/k2-fsa/sherpa-onnx/releases/download/${tag}/${file}`;
// Whisper's multilingual vocabulary: the same blob in both repos
const TOKENS = { gitBlob: 'a4edf0b719c10d28cd83f8c294449f99ff5d5dc0', size: 816_730 };

export const VAD: VoicePart = { id: 'vad', files: [
  { name: 'silero_vad.onnx', url: GH('asr-models', 'silero_vad.onnx'), check: { sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6' }, bytes: 644_000 },
] };

const SMALL = { repo: 'csukuangfj/sherpa-onnx-whisper-small', rev: '8f3c18b358db4d1f2fc1eae49d75cd20989e4309' };
const TURBO = { repo: 'csukuangfj/sherpa-onnx-whisper-turbo', rev: '2ca6ff69fc878651b770880507669577ac41c2ff' };
export const ASR: Record<VoiceAsr, VoicePart> = {
  fast: { id: 'whisper-small', files: [
    { name: 'encoder.onnx', url: HF(SMALL.repo, SMALL.rev, 'small-encoder.int8.onnx'), check: { sha256: '4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9' }, bytes: 112_442_483 },
    { name: 'decoder.onnx', url: HF(SMALL.repo, SMALL.rev, 'small-decoder.int8.onnx'), check: { sha256: 'acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee' }, bytes: 262_226_114 },
    { name: 'tokens.txt', url: HF(SMALL.repo, SMALL.rev, 'small-tokens.txt'), check: TOKENS, bytes: TOKENS.size },
  ] },
  accurate: { id: 'whisper-turbo', files: [
    { name: 'encoder.onnx', url: HF(TURBO.repo, TURBO.rev, 'turbo-encoder.int8.onnx'), check: { sha256: 'b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b' }, bytes: 674_716_297 },
    { name: 'decoder.onnx', url: HF(TURBO.repo, TURBO.rev, 'turbo-decoder.int8.onnx'), check: { sha256: '20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547' }, bytes: 361_080_764 },
    { name: 'tokens.txt', url: HF(TURBO.repo, TURBO.rev, 'turbo-tokens.txt'), check: TOKENS, bytes: TOKENS.size },
  ] },
};

const piper = (id: string, sha256: string, mb: number): VoicePart => ({ id: `piper-${id}`, files: [
  { name: `vits-piper-it_IT-${id}.tar.bz2`, url: GH('tts-models', `vits-piper-it_IT-${id}.tar.bz2`), check: { sha256 }, bytes: mb * 1_000_000, untar: true },
] });
export const TTS: Record<VoiceName, VoicePart> = {
  paola: piper('paola-medium', '7541f75778afa164e44e34baaef63befad7698595df26a95ca944b63ef1a16b4', 64.1),
  miro: piper('miro-high', '4612a986f49680b571b8fe0b03f0b292b34c843178fd6e07826bf52de10157c4', 64.1),
  dii: piper('dii-high', 'fb5ff18ca81d1d35de064bfdb58d04d153d1dcf8523e1fa3429e231aea860c78', 64.1),
};

/** The parts the chosen settings need, in download order (the small VAD first, the voice before the big Whisper). */
export const partsFor = (asr: VoiceAsr, voice: VoiceName): VoicePart[] => [VAD, TTS[voice], ASR[asr]];
export const partBytes = (p: VoicePart): number => p.files.reduce((n, f) => n + f.bytes, 0);

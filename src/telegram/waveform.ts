// Telegram voice-note waveform: 100 samples of 5 bits (0–31), packed
// little-endian, as the official apps write `documentAttributeAudio.waveform`.

export const WAVEFORM_SAMPLES = 100;

/** Packs input levels (0..1, any count) into Telegram's 5-bit waveform. */
export function encodeWaveform(levels: readonly number[], samples: number = WAVEFORM_SAMPLES): Uint8Array {
  const values: number[] = [];
  if (levels.length > 0) {
    for (let index = 0; index < samples; index += 1) {
      // Peak of the levels that fall in this sample's slice.
      const from = Math.floor((index * levels.length) / samples);
      const to = Math.max(from + 1, Math.floor(((index + 1) * levels.length) / samples));
      values.push(Math.max(...levels.slice(from, to)));
    }
  }
  const peak = Math.max(0.01, ...values);
  const bytes = new Uint8Array(Math.ceil((values.length * 5) / 8) + 1);
  values.forEach((level, index) => {
    const value = Math.min(31, Math.max(0, Math.round((Math.min(1, Math.max(0, level)) / peak) * 31)));
    const bit = index * 5;
    const byte = bit >> 3;
    const shifted = value << (bit & 7);
    bytes[byte] |= shifted & 0xff;
    bytes[byte + 1] |= shifted >> 8;
  });
  return bytes.subarray(0, Math.ceil((values.length * 5) / 8));
}

/** Unpacks a Telegram waveform into values 0–31 (used by the tests). */
export function decodeWaveform(bytes: Uint8Array): number[] {
  const count = Math.floor((bytes.length * 8) / 5);
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const bit = index * 5;
    const byte = bit >> 3;
    const word = bytes[byte] | ((bytes[byte + 1] ?? 0) << 8);
    values.push((word >> (bit & 7)) & 0x1f);
  }
  return values;
}

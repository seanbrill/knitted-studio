// One take, cut into lines. A voice model asked for each line on its own speaks each a
// little differently: another pitch, another pace. Spoken whole, it is one voice; then it is
// cut at the pauses between the lines, so each line is still its own clip on the timeline.

/** A WAV's format and where its samples are. Only plain PCM and float WAVs: what speech servers send. */
export function readWav(buf) {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let at = 12, fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    let size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") fmt = { format: buf.readUInt16LE(at + 8), channels: buf.readUInt16LE(at + 10), sampleRate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    if (id === "data") {
      // A streamed WAV can say 0 or 0xFFFFFFFF: then the samples run to the end.
      if (!size || size === 0xffffffff || at + 8 + size > buf.length) size = buf.length - at - 8;
      if (!fmt || !((fmt.format === 1 && fmt.bits === 16) || (fmt.format === 3 && fmt.bits === 32))) return null;
      return { ...fmt, dataOffset: at + 8, dataLength: size, frameBytes: (fmt.bits / 8) * fmt.channels };
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** Loudness every 10ms, the channels mixed. */
function loudness(buf, w, frameMs) {
  const per = Math.max(1, Math.round((w.sampleRate * frameMs) / 1000));
  const frames = Math.floor(w.dataLength / w.frameBytes);
  const out = [];
  for (let f = 0; f < frames; f += per) {
    let sum = 0, n = 0;
    for (let i = f; i < Math.min(frames, f + per); i++) {
      for (let c = 0; c < w.channels; c++) {
        const o = w.dataOffset + i * w.frameBytes + c * (w.bits / 8);
        const v = w.format === 1 ? buf.readInt16LE(o) / 32768 : buf.readFloatLE(o);
        sum += v * v; n++;
      }
    }
    out.push(Math.sqrt(sum / Math.max(1, n)));
  }
  return out;
}

/**
 * Where to cut one take of `weights.length` lines: at the pause nearest where each line
 * should end, going by how long each line is. Returns the cuts in ms, one fewer than lines.
 */
export function cutPoints(buf, w, weights, o) { return planCuts(buf, w, weights, o).map((c) => c.at); }

/** As cutPoints, each cut saying whether it falls in a real pause (true) or was only a guess. */
export function planCuts(buf, w, weights, { frameMs = 10, minPauseMs = 120 } = {}) {
  const rms = loudness(buf, w, frameMs);
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0, loud = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const quiet = floor + 0.08 * (loud - floor);
  const first = rms.findIndex((v) => v > quiet), last = rms.length - 1 - [...rms].reverse().findIndex((v) => v > quiet);
  const pauses = [];
  for (let i = Math.max(0, first), run = 0; i <= last; i++) {
    if (rms[i] <= quiet) run++;
    else { if (run * frameMs >= minPauseMs) pauses.push({ mid: (i - run / 2) * frameMs, len: run * frameMs }); run = 0; }
  }
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const span = [first * frameMs, last * frameMs];
  const cuts = [];
  let sum = 0, after = span[0];
  for (let i = 0; i < weights.length - 1; i++) {
    sum += weights[i];
    const want = span[0] + (span[1] - span[0]) * (sum / total);
    const left = weights.length - 2 - i; // pauses still needed after this one
    // Leave enough pauses for the cuts still to come, when the take has that many; when it has
    // fewer (the voice ran some lines together), each cut takes the best pause near it.
    const enough = pauses.length >= weights.length - 1;
    const open = pauses.filter((p) => p.mid > after + 200 && (!enough || pauses.filter((q) => q.mid > p.mid).length >= left));
    // Near where the line should end, and long: a sentence's end is a longer pause than a breath.
    const score = (p) => Math.abs(p.mid - want) / (p.len + 100);
    const pick = open.sort((a, b) => score(a) - score(b))[0];
    const pause = !!pick && Math.abs(pick.mid - want) < (span[1] - span[0]) / weights.length;
    const at = pause ? pick.mid : want;
    cuts.push({ at: Math.round(at), pause }); after = at;
  }
  return cuts;
}

/** A WAV of the samples between two times. */
export function sliceWav(buf, w, fromMs, toMs) {
  const at = (ms) => Math.min(w.dataLength, Math.max(0, Math.round((ms / 1000) * w.sampleRate) * w.frameBytes));
  const data = buf.subarray(w.dataOffset + at(fromMs), w.dataOffset + at(toMs));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(w.format, 20); h.writeUInt16LE(w.channels, 22); h.writeUInt32LE(w.sampleRate, 24); h.writeUInt32LE(w.sampleRate * w.frameBytes, 28);
  h.writeUInt16LE(w.frameBytes, 32); h.writeUInt16LE(w.bits, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** How far a line's pace may stray from the take's before its cut is not trusted. */
const PACE = { slow: 0.5, fast: 2 };

/**
 * Cut one take into clips, checked against the script: a clip per line where the voice paused
 * between lines and each line took about as long as its words should. Where it ran two lines
 * together, or a cut would leave one line far too fast or slow (the pause found was inside a
 * line), those lines stay one clip, so no word is ever split; `lines` then times each inside it
 * by its length. Null when the WAV is not one this can read: then the take stays whole.
 */
export function cutTake(buf, lines) {
  const w = readWav(buf);
  if (!w) return null;
  const totalMs = (w.dataLength / w.frameBytes / w.sampleRate) * 1000;
  const weights = lines.map((l) => Math.max(1, l.length));
  const cuts = lines.length > 1 ? planCuts(buf, w, weights) : [];
  const edges = [0, ...cuts.map((c) => c.at), totalMs];
  const all = weights.reduce((a, b) => a + b, 0);
  const pace = (i) => (edges[i + 1] - edges[i]) / weights[i] / (totalMs / all); // 1: as the take goes
  const fair = (i) => pace(i) >= PACE.slow && pace(i) <= PACE.fast;
  const trusted = cuts.map((c, i) => c.pause && fair(i) && fair(i + 1));
  const clips = [];
  for (let i = 0; i < lines.length; i++) {
    const line = { text: lines[i], fromMs: edges[i], toMs: edges[i + 1] };
    if (i > 0 && !trusted[i - 1]) clips.at(-1).lines.push(line);
    else clips.push({ lines: [line] });
  }
  return clips.map((c) => {
    const fromMs = c.lines[0].fromMs, toMs = c.lines.at(-1).toMs;
    if (c.lines.length > 1) { // timed by length inside the clip: the guessed cuts are not to be relied on
      const sum = c.lines.reduce((a, l) => a + Math.max(1, l.text.length), 0);
      let at = fromMs;
      for (const l of c.lines) { const d = ((toMs - fromMs) * Math.max(1, l.text.length)) / sum; l.fromMs = at; l.toMs = at + d; at += d; }
    }
    return { text: c.lines.map((l) => l.text).join(" "), fromMs, toMs, lines: c.lines, wav: sliceWav(buf, w, fromMs, toMs) };
  });
}

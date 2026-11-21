import { h, dropzone, field, statusArea, progressBar, selectControl, downloadBlob, formatSavings } from '../ui';
import { LIMITS } from '../../lib/files';
import { formatBytes, safeBaseName } from '../../lib/format';
import {
  AUDIO_BPS, PRESET_LABEL, bitrateForTargetSize, estimateBytes, fitDimensions, formatDuration, presetBitrate, resolveTrim,
  type Codec, type Preset,
} from '../../lib/video';
import {
  ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, WebMOutputFormat, canEncodeVideo,
  type InputVideoTrack,
} from 'mediabunny';

type Choice = 'mp4-avc' | 'webm-vp9' | 'mp4-av1';
const CHOICES: Record<Choice, { label: string; codec: Codec; container: 'mp4' | 'webm'; ext: string; mime: string; webcodec: 'avc' | 'vp9' | 'av1' }> = {
  'mp4-avc': { label: 'MP4 (H.264)', codec: 'avc', container: 'mp4', ext: 'mp4', mime: 'video/mp4', webcodec: 'avc' },
  'webm-vp9': { label: 'WebM (VP9)', codec: 'vp9', container: 'webm', ext: 'webm', mime: 'video/webm', webcodec: 'vp9' },
  'mp4-av1': { label: 'MP4 (AV1)', codec: 'av1', container: 'mp4', ext: 'mp4', mime: 'video/mp4', webcodec: 'av1' },
};

interface Loaded { file: File; input: Input; track: InputVideoTrack; hasAudio: boolean; duration: number; width: number; height: number; fps: number; sourceBps: number }

export async function mount(root: HTMLElement) {
  const status = statusArea();
  const progress = progressBar();

  // WebCodecs is what makes in-browser, hardware-accelerated encoding possible. Say clearly when it is missing.
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || !window.isSecureContext) {
    root.append(h('div', { class: 'notice notice-error', role: 'alert' }, h('span', { text: 'This browser cannot compress video on-device. Please use a current version of Chrome, Edge, Safari (16.4 or newer) or Firefox (130 or newer), and open the site over HTTPS.' })));
    return;
  }
  const supported = new Set<Choice>();
  for (const [key, c] of Object.entries(CHOICES) as [Choice, (typeof CHOICES)[Choice]][]) {
    try { if (await canEncodeVideo(c.webcodec, { width: 1280, height: 720, bitrate: 2_000_000 })) supported.add(key); } catch { /* treated as unsupported */ }
  }
  if (!supported.size) {
    root.append(h('div', { class: 'notice notice-error', role: 'alert' }, h('span', { text: 'This browser has video encoding turned off for every format this tool offers (H.264, VP9, AV1). Try a different browser.' })));
    return;
  }

  let loaded: Loaded | null = null;
  let conversion: Conversion | null = null;
  let resultUrl: string | null = null;
  let resultBlob: Blob | null = null;
  let resultName = '';
  let canceled = false;

  const info = h('div', { class: 'video-info', hidden: true });
  const mode = h('div', { class: 'seg', role: 'group', 'aria-label': 'Compression mode' });
  const modeQuality = h('button', { type: 'button', 'aria-pressed': 'true' }, 'Quality preset');
  const modeSize = h('button', { type: 'button', 'aria-pressed': 'false' }, 'Target file size');
  mode.append(modeQuality, modeSize);

  const preset = selectControl(Object.entries(PRESET_LABEL) as [string, string][], 'balanced');
  const targetMb = h('input', { type: 'number', min: 1, step: 1, inputmode: 'numeric', placeholder: 'e.g. 25' });
  const presetField = field('Quality', preset, 'Balanced suits most videos. Lower settings shrink files more.');
  const targetField = field('Target size (MB)', targetMb, 'The tool picks a bitrate to land close to this. Very small targets mean visible quality loss.');
  targetField.hidden = true;

  const resolution = selectControl([['orig', 'Original size']], 'orig');
  const fps = selectControl([['orig', 'Original'], ['30', 'Up to 30 fps'], ['24', 'Up to 24 fps'], ['15', 'Up to 15 fps']], 'orig');
  const format = selectControl((Object.keys(CHOICES) as Choice[]).filter((k) => supported.has(k)).map((k) => [k, CHOICES[k].label] as [string, string]), supported.has('mp4-avc') ? 'mp4-avc' : [...supported][0]);
  const audio = selectControl([['keep', `Keep audio (re-encoded at ${AUDIO_BPS / 1000} kbps)`], ['remove', 'Remove audio']], 'keep');
  const trimStart = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0:00', autocomplete: 'off' });
  const trimEnd = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'End of video', autocomplete: 'off' });
  const estimate = h('p', { class: 'hint video-estimate', 'aria-live': 'polite' });

  const opts = h('div', { hidden: true },
    mode,
    h('div', { class: 'row' }, presetField, targetField, field('Resolution', resolution, 'Never upscaled. Lower resolution is the biggest saver.')),
    h('div', { class: 'row' }, field('Frame rate', fps), field('Output format', format, 'H.264 plays everywhere. VP9 and AV1 are smaller.'), field('Audio', audio)),
    h('div', { class: 'row' }, field('Trim: start (optional)', trimStart, 'Seconds or m:ss, e.g. 12 or 0:12.'), field('Trim: end (optional)', trimEnd)),
    estimate);

  const compressBtn = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Compress video');
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary', hidden: true }, 'Cancel');
  const clearBtn = h('button', { type: 'button', class: 'btn btn-secondary', disabled: true }, 'Clear');
  const result = h('div', { class: 'video-result', hidden: true });

  const selected = () => CHOICES[format.value as Choice];
  const heightLimit = () => (resolution.value === 'orig' ? null : Number(resolution.value));
  const trimmedDuration = () => {
    if (!loaded) return 0;
    const t = resolveTrim(trimStart.value, trimEnd.value, loaded.duration);
    if (t.error) return loaded.duration;
    return Math.max(0.1, (t.end ?? loaded.duration) - (t.start ?? 0));
  };
  const outputDims = () => (loaded ? fitDimensions(loaded.width, loaded.height, heightLimit()) : { width: 0, height: 0, scaled: false });
  const outputFps = () => {
    const src = loaded?.fps || 30; const cap = fps.value === 'orig' ? Infinity : Number(fps.value);
    return Math.min(src, cap);
  };
  const audioBps = () => (loaded?.hasAudio && audio.value === 'keep' ? AUDIO_BPS : 0);
  const videoBps = () => {
    if (!loaded) return 0;
    const dur = trimmedDuration();
    if (modeSize.getAttribute('aria-pressed') === 'true') {
      const mb = Number(targetMb.value);
      return mb > 0 ? bitrateForTargetSize(mb * 1024 * 1024, dur, audioBps()) : 0;
    }
    const d = outputDims();
    return presetBitrate(preset.value as Preset, selected().codec, d.width, d.height, outputFps(), loaded.sourceBps);
  };

  const updateEstimate = () => {
    if (!loaded) return;
    const v = videoBps();
    if (!v) { estimate.textContent = 'Enter a target size to see an estimate.'; return; }
    const est = estimateBytes(v, audioBps(), trimmedDuration());
    const d = outputDims();
    estimate.textContent = `Estimated result: about ${formatBytes(est)} at ${d.width}×${d.height}${est >= loaded.file.size ? '. That is not smaller than the original, so lower the quality or resolution.' : ` (roughly ${Math.max(0, Math.round((1 - est / loaded.file.size) * 100))}% smaller).`}`;
  };
  const setMode = (size: boolean) => {
    modeSize.setAttribute('aria-pressed', String(size)); modeQuality.setAttribute('aria-pressed', String(!size));
    presetField.hidden = size; targetField.hidden = !size; updateEstimate();
  };
  modeQuality.addEventListener('click', () => setMode(false));
  modeSize.addEventListener('click', () => setMode(true));
  for (const el of [preset, targetMb, resolution, fps, format, audio, trimStart, trimEnd]) { el.addEventListener('input', updateEstimate); el.addEventListener('change', updateEstimate); }

  const clearResult = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null; resultBlob = null; result.hidden = true; result.replaceChildren();
  };
  const reset = async () => {
    clearResult(); status.clear(); progress.hide();
    try { loaded?.input.dispose?.(); } catch { /* ignore */ }
    loaded = null; info.hidden = true; info.replaceChildren(); opts.hidden = true;
    compressBtn.disabled = clearBtn.disabled = true;
  };

  const dz = dropzone({
    kinds: ['mp4', 'webm'], multiple: false, maxBytes: LIMITS.videoBytes, title: 'Drop a video here',
    onErrors: (e) => { status.clear(); if (e.length) status.show('error', ['The file was not added:', ...e]); },
    onFiles: async (files) => {
      await reset();
      const file = files[0].file;
      status.show('info', 'Reading the video…');
      try {
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('No video track was found in this file.');
        if (!(await track.canDecode())) throw new Error(`This browser cannot decode the video format used by this file (${track.codec ?? 'unknown codec'}). Try opening it in Chrome or Edge, or re-export it as H.264 MP4.`);
        const audioTrack = await input.getPrimaryAudioTrack();
        const duration = await input.computeDuration();
        let rate = 30, bps = 0;
        try { const s = await track.computePacketStats(120); if (Number.isFinite(s.averagePacketRate) && s.averagePacketRate > 0) rate = s.averagePacketRate; } catch { /* keep default */ }
        if (duration > 0) bps = (file.size * 8) / duration;
        const rot = track.rotation % 180 !== 0;
        const width = rot ? track.displayHeight : track.displayWidth; const height = rot ? track.displayWidth : track.displayHeight;
        loaded = { file, input, track, hasAudio: !!audioTrack, duration, width, height, fps: Math.round(rate * 10) / 10, sourceBps: bps };
        status.clear();

        // Offer only resolutions smaller than the source.
        const short = Math.min(width, height);
        const levels = [1080, 720, 480, 360, 240].filter((l) => l < short);
        resolution.replaceChildren(...[['orig', `Original (${width}×${height})`], ...levels.map((l) => [String(l), `${l}p`])].map(([v, l]) => h('option', { value: v, text: l })));
        resolution.value = levels.includes(720) ? '720' : 'orig';
        audio.disabled = !audioTrack; if (!audioTrack) audio.value = 'remove';

        info.replaceChildren(
          h('strong', { class: 'video-name', text: file.name, title: file.name }),
          h('div', { class: 'video-stats' },
            ...[['Size', formatBytes(file.size)], ['Length', formatDuration(duration)], ['Resolution', `${width}×${height}`], ['Frame rate', `${loaded.fps} fps`], ['Codec', (track.codec ?? 'unknown').toUpperCase()], ['Audio', audioTrack ? 'Yes' : 'None']]
              .map(([k, v]) => h('span', { class: 'video-stat' }, h('em', { text: k }), h('b', { text: v })))));
        info.hidden = false; opts.hidden = false; compressBtn.disabled = clearBtn.disabled = false;
        updateEstimate();
      } catch (e) {
        status.set('error', e instanceof Error ? e.message : 'This video could not be read. It may be damaged or use an unsupported format.');
        loaded = null;
      }
    },
  });

  const run = async () => {
    if (!loaded) return;
    status.clear(); clearResult(); canceled = false;
    const L = loaded;
    const choice = selected();
    const trim = resolveTrim(trimStart.value, trimEnd.value, L.duration);
    if (trim.error) { status.show('error', trim.error); return; }
    const isSize = modeSize.getAttribute('aria-pressed') === 'true';
    if (isSize && !(Number(targetMb.value) > 0)) { status.show('error', 'Enter a target size in MB, or switch to a quality preset.'); return; }
    const bitrate = videoBps();
    const dims = outputDims();
    const fpsCap = fps.value === 'orig' ? undefined : Number(fps.value);

    compressBtn.disabled = true; clearBtn.disabled = true; cancelBtn.hidden = false;
    const t0 = performance.now();
    progress.set(0, 100, 'Starting…');
    try {
      const target = new BufferTarget();
      const output = new Output({ format: choice.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(), target });
      conversion = await Conversion.init({
        input: L.input, output, showWarnings: false,
        video: { width: dims.width, height: dims.height, fit: 'fill', codec: choice.webcodec, bitrate, frameRate: fpsCap && L.fps > fpsCap ? fpsCap : undefined, forceTranscode: true, hardwareAcceleration: 'no-preference' },
        audio: audio.value === 'remove' || !L.hasAudio ? { discard: true } : { bitrate: AUDIO_BPS, forceTranscode: true },
        trim: trim.start !== undefined || trim.end !== undefined ? { start: trim.start, end: trim.end } : undefined,
      });
      if (!conversion.isValid) {
        const why = conversion.discardedTracks.map((d) => d.reason).join(', ');
        throw new Error(`This video cannot be converted in this browser (${why || 'no usable tracks'}). Try another output format.`);
      }
      conversion.onProgress = (p) => {
        const pct = Math.round(p * 100); const el = (performance.now() - t0) / 1000;
        const eta = p > 0.03 ? Math.max(0, el / p - el) : null;
        progress.set(pct, 100, `Compressing… ${pct}%${eta !== null ? ` · about ${formatDuration(eta)} left` : ''}`);
      };
      await conversion.execute();
      const buf = target.buffer;
      if (!buf) throw new Error('The encoder finished without producing a file.');
      resultBlob = new Blob([buf], { type: choice.mime });
      resultName = `${safeBaseName(L.file.name, 'video')}-compressed.${choice.ext}`;
      resultUrl = URL.createObjectURL(resultBlob);
      showResult(L, resultBlob, (performance.now() - t0) / 1000);
    } catch (e) {
      if (canceled) status.show('info', 'Compression canceled.');
      else status.show('error', ['The video could not be compressed.', e instanceof Error ? e.message : 'Unknown error. Try a different output format or a lower resolution.']);
    } finally {
      progress.hide(); conversion = null; cancelBtn.hidden = true; compressBtn.disabled = false; clearBtn.disabled = false;
    }
  };

  const showResult = (L: Loaded, blob: Blob, seconds: number) => {
    const s = formatSavings(L.file.size, blob.size);
    status.show(s.good ? 'success' : 'warn', s.good
      ? `Done in ${formatDuration(seconds)}. ${formatBytes(L.file.size)} → ${formatBytes(blob.size)}, ${s.text}.`
      : `Done, but the result (${formatBytes(blob.size)}) is not smaller than the original (${formatBytes(L.file.size)}). Keep the original, or choose a lower quality or resolution.`);
    const video = h('video', { class: 'video-preview', controls: true, preload: 'metadata', src: resultUrl!, 'aria-label': 'Preview of the compressed video' });
    result.replaceChildren(video,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => resultBlob && downloadBlob(resultBlob, resultName) }, `Download ${resultName.length > 34 ? 'video' : resultName}`)));
    result.hidden = false;
  };

  compressBtn.addEventListener('click', () => { void run(); });
  cancelBtn.addEventListener('click', async () => { canceled = true; try { await conversion?.cancel(); } catch { /* already finished */ } });
  clearBtn.addEventListener('click', () => { void reset(); });

  root.append(dz.el, info, opts, h('div', { class: 'actions' }, compressBtn, cancelBtn, clearBtn), progress.el, status.el, result,
    h('p', { class: 'hint', text: 'Your video is decoded and re-encoded on this device using the browser\'s own video engine. Nothing is uploaded.' }));
}

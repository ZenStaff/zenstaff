"""Rough cut from raw footage, all on this computer: inventory, transcription (faster-whisper),
proposed selects (soundbites + b-roll with steady motion), and an edit exported as FCP7 XML
(Premiere Pro, DaVinci Resolve), FCPXML (Final Cut Pro), CMX3600 EDL and a preview MP4.

Usage (run with the prepared whisper-python):
  roughcut.py inventory  --footage <folder> --out <work>
  roughcut.py transcribe --out <work> --language ro --model <model dir>
  roughcut.py selects    --out <work> [--keywords "word word"]
  roughcut.py export     --out <work> --edit <edit.json> [--fps 25] [--name ROUGH_CUT]
"""
import argparse
import collections
import csv
import html
import json
import os
import re
import subprocess
import sys
import urllib.parse
from fractions import Fraction

FFMPEG = os.environ.get("ZEN_TOOL_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("ZEN_TOOL_FFPROBE", "ffprobe")
VIDEO = re.compile(r"\.(mp4|mov|m4v|mxf|mts|m2ts|avi|mkv|webm)$", re.I)
LANGS = {"romanian": "ro", "english": "en", "hungarian": "hu", "german": "de", "french": "fr", "italian": "it", "spanish": "es", "română": "ro", "engleză": "en"}


def fail(message):
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def hms(seconds):
    seconds = max(0.0, float(seconds))
    return f"{int(seconds // 3600):02d}:{int(seconds % 3600 // 60):02d}:{seconds % 60:06.3f}"


def probe(path):
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate,channels:stream_side_data=rotation:format=duration", "-of", "json", path], capture_output=True, text=True)
    info = json.loads(out.stdout or "{}")
    streams = info.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not v:
        return None
    rot = abs(int(float(((v.get("side_data_list") or [{}])[0]).get("rotation", 0) or 0)))
    w, h = (v.get("height"), v.get("width")) if rot in (90, 270) else (v.get("width"), v.get("height"))
    num, _, den = (v.get("avg_frame_rate") or "25/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 25.0
    return {"width": w, "height": h, "fps": round(fps, 3), "seconds": round(float(info.get("format", {}).get("duration", 0) or 0), 3), "audio": bool(a), "channels": (a or {}).get("channels", 0)}


def load_inventory(out):
    path = os.path.join(out, "inventory.json")
    if not os.path.exists(path):
        fail(f"{path} is missing: run the inventory step first.")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def cmd_inventory(a):
    footage = os.path.abspath(a.footage)
    if not os.path.isdir(footage):
        fail(f"{footage} is not a folder.")
    os.makedirs(os.path.join(a.out, "sheets"), exist_ok=True)
    clips = []
    for root, dirs, files in os.walk(footage):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for name in sorted(files):
            if VIDEO.search(name):
                clips.append(os.path.join(root, name))
    if not clips:
        fail(f"No video files in {footage}.")
    items = []
    for index, path in enumerate(clips, 1):
        info = probe(path)
        rel = os.path.relpath(path, footage)
        if not info:
            items.append({"id": f"C{index:03d}", "file": path, "name": rel, "error": "not a readable video"})
            continue
        cid = f"C{index:03d}"
        sheet = os.path.join(a.out, "sheets", f"{cid}.jpg")
        step = max(info["seconds"] / 8, 0.5)
        font = os.path.join(os.environ.get("ZEN_FONTS_DIR", ""), "Barlow-SemiBold.ttf")
        label = f",drawtext=fontfile='{font}':text='{cid} %{{pts\\:hms}}':x=6:y=h-th-6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4" if os.path.exists(font) else ""
        subprocess.run([FFMPEG, "-y", "-v", "error", "-i", path, "-vf", f"fps=1/{step:.3f},scale=320:-2{label},tile=4x2:padding=4:color=white", "-frames:v", "1", "-q:v", "4", sheet], capture_output=True)
        items.append({"id": cid, "file": path, "name": rel, "sheet": sheet, **info})
    total = sum(i.get("seconds", 0) for i in items)
    with open(os.path.join(a.out, "inventory.json"), "w", encoding="utf-8") as fh:
        json.dump({"footage": footage, "clips": items}, fh, ensure_ascii=False, indent=1)
    by_size = collections.Counter(f"{i.get('width')}x{i.get('height')} @ {i.get('fps')}" for i in items if "error" not in i)
    lines = ["# Footage inventory", "", f"{len(items)} clips, {hms(total)} in total.", "", "Formats: " + ", ".join(f"{k} ({v})" for k, v in by_size.items()), "", "| Clip | File | Length | Size | fps | Sound |", "| ---- | ---- | ------ | ---- | --- | ----- |"]
    for i in items:
        lines.append(f"| {i['id']} | {i['name']} | {hms(i.get('seconds', 0))} | {i.get('width')}x{i.get('height')} | {i.get('fps')} | {'yes' if i.get('audio') else 'no'} |" if "error" not in i else f"| {i['id']} | {i['name']} | - | - | - | {i['error']} |")
    with open(os.path.join(a.out, "inventory.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(json.dumps({"clips": len(items), "total": hms(total), "formats": dict(by_size), "inventory": os.path.join(a.out, "inventory.md"), "sheets": os.path.join(a.out, "sheets")}, indent=1))


def srt_time(s):
    ms = int(round(max(0.0, s) * 1000))
    return f"{ms // 3600000:02d}:{ms % 3600000 // 60000:02d}:{ms % 60000 // 1000:02d},{ms % 1000:03d}"


def cmd_transcribe(a):
    from faster_whisper import WhisperModel

    inv = load_inventory(a.out)
    raw = (a.language or "").strip().lower()
    language = None if not raw or raw.startswith(("detect", "auto")) else LANGS.get(raw, raw[:2])
    if not a.model or not os.path.isdir(a.model):
        fail("The speech model is not prepared: pass --model \"$ZEN_WHISPER_MODEL_SMALL\" (or _BASE / _TINY).")
    model = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=max(1, (os.cpu_count() or 2) - 1))
    tdir = os.path.join(a.out, "transcripts")
    os.makedirs(tdir, exist_ok=True)
    full = ["# Everything said in the footage", ""]
    for clip in inv["clips"]:
        if "error" in clip or not clip.get("audio"):
            continue
        segments, info = model.transcribe(clip["file"], language=language, vad_filter=True, word_timestamps=True, beam_size=5, condition_on_previous_text=False)
        segs = []
        for s in segments:
            text = s.text.strip()
            if not text:
                continue
            segs.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": text, "words": [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word} for w in (s.words or [])], "confidence": round(float(getattr(s, "avg_logprob", 0)), 2)})
        with open(os.path.join(tdir, f"{clip['id']}.json"), "w", encoding="utf-8") as fh:
            json.dump({"clip": clip["id"], "language": info.language, "segments": segs}, fh, ensure_ascii=False, indent=1)
        with open(os.path.join(tdir, f"{clip['id']}.srt"), "w", encoding="utf-8") as fh:
            for n, s in enumerate(segs, 1):
                fh.write(f"{n}\n{srt_time(s['start'])} --> {srt_time(s['end'])}\n{s['text']}\n\n")
        full.append(f"## {clip['id']} · {clip['name']}")
        full.append("")
        full.extend(f"- [{hms(s['start'])[3:8]}-{hms(s['end'])[3:8]}] {s['text']}" for s in segs)
        full.append("")
        print(f"{clip['id']}: {len(segs)} segments ({info.language})")
    path = os.path.join(a.out, "transcript.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(full) + "\n")
    print(json.dumps({"transcript": path, "folder": tdir}, indent=1))


def motion_profile(path):
    vf = "scale=64:36,fps=4,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG"
    p = subprocess.run([FFMPEG, "-v", "info", "-nostats", "-i", path, "-vf", vf, "-an", "-f", "null", "-"], capture_output=True, text=True)
    t, per = None, collections.defaultdict(list)
    for line in (p.stderr or "").splitlines() + (p.stdout or "").splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m:
            t = float(m.group(1))
            continue
        m = re.search(r"YAVG=([\d.]+)", line)
        if m and t is not None:
            per[int(t)].append(float(m.group(1)))
    return {k: sum(v) / len(v) for k, v in per.items()}


def cmd_selects(a):
    inv = load_inventory(a.out)
    keywords = [w.lower() for w in re.findall(r"\w+", a.keywords or "") if len(w) > 2]
    rows = []
    for clip in inv["clips"]:
        if "error" in clip:
            continue
        tpath = os.path.join(a.out, "transcripts", f"{clip['id']}.json")
        speech = []
        if os.path.exists(tpath):
            with open(tpath, encoding="utf-8") as fh:
                speech = json.load(fh)["segments"]
        # Soundbites: neighbouring segments joined into 3-25 s thoughts that end on a full stop.
        bite = None
        for s in speech + [None]:
            if bite and (s is None or s["start"] - bite["end"] > 1.2 or bite["end"] - bite["start"] > 18 or re.search(r"[.!?]$", bite["text"])):
                if bite["end"] - bite["start"] >= 2.5:
                    words = re.findall(r"\w+", bite["text"].lower())
                    hits = sum(1 for w in words if any(w.startswith(k[:5]) for k in keywords))
                    score = round(hits * 2 + min(bite["end"] - bite["start"], 15) / 5 + (1 + bite["conf"] / 2), 2)
                    rows.append({"clip": clip["id"], "name": clip["name"], "type": "speech", "in": round(max(0, bite["start"] - 0.3), 2), "out": round(min(clip["seconds"], bite["end"] + 0.4), 2), "score": score, "text": bite["text"]})
                bite = None
            if s is None:
                break
            if bite is None:
                bite = {"start": s["start"], "end": s["end"], "text": s["text"], "conf": s["confidence"]}
            else:
                bite["end"], bite["text"] = s["end"], f"{bite['text']} {s['text']}"
                bite["conf"] = min(bite["conf"], s["confidence"])
        # B-roll: steady moving 4 s windows outside speech.
        talk = [(s["start"], s["end"]) for s in speech]
        prof = motion_profile(clip["file"])
        windows = []
        for st in sorted(prof):
            if st < 0.5 or st + 4 > clip["seconds"] - 0.3:
                continue
            if any(not (st + 4 <= ts or st >= te) for ts, te in talk):
                continue
            vals = [prof.get(x, 0) for x in range(st, st + 4)]
            mean = sum(vals) / len(vals)
            spread = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5
            windows.append((mean / (1 + spread), st))
        taken = []
        for sc, st in sorted(windows, reverse=True):
            if any(abs(st - t) < 4 for t in taken):
                continue
            taken.append(st)
            rows.append({"clip": clip["id"], "name": clip["name"], "type": "broll", "in": float(st), "out": float(st + 4), "score": round(sc, 2), "text": ""})
            if len(taken) >= 3:
                break
    rows.sort(key=lambda r: (r["clip"], r["in"]))
    for n, r in enumerate(rows, 1):
        r["id"] = f"S{n:03d}"
    path = os.path.join(a.out, "selects.csv")
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["id", "clip", "name", "type", "in", "out", "score", "text"])
        w.writeheader()
        w.writerows(rows)
    with open(os.path.join(a.out, "selects.json"), "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=1)
    print(json.dumps({"selects": path, "speech": sum(r["type"] == "speech" for r in rows), "broll": sum(r["type"] == "broll" for r in rows)}, indent=1))


def tc(frames, fps):
    base = int(round(fps))
    f = int(frames)
    return f"{f // (base * 3600):02d}:{f // (base * 60) % 60:02d}:{f // base % 60:02d}:{f % base:02d}"


def cmd_export(a):
    inv = load_inventory(a.out)
    clips = {c["id"]: c for c in inv["clips"] if "error" not in c}
    try:
        with open(a.edit, encoding="utf-8") as fh:
            edit = json.load(fh)
    except Exception as error:
        fail(f"The edit could not be read: {error}")
    selects = {}
    spath = os.path.join(a.out, "selects.json")
    if os.path.exists(spath):
        with open(spath, encoding="utf-8") as fh:
            selects = {r["id"]: r for r in json.load(fh)}
    fps = float(edit.get("fps") or a.fps)
    if fps not in (23.976, 24, 25, 29.97, 30, 50, 59.94, 60):
        fail("fps must be 24, 25, 30, 50 or 60 (or 23.976 / 29.97 / 59.94).")
    name = re.sub(r"[^A-Za-z0-9_-]+", "_", edit.get("name") or a.name)[:40] or "ROUGH_CUT"
    items = []
    for n, item in enumerate(edit.get("items", []), 1):
        if "select" in item:
            sel = selects.get(item["select"])
            if not sel:
                fail(f"items[{n}]: select {item['select']} is not in selects.json.")
            item = {**sel, **{k: v for k, v in item.items() if k != "select"}}
        clip = clips.get(item.get("clip"))
        if not clip:
            fail(f"items[{n}]: clip {item.get('clip')} is not in the inventory.")
        cin, cout = float(item["in"]), float(item["out"])
        if not (0 <= cin < cout <= clip["seconds"] + 0.05):
            fail(f"items[{n}]: in/out must be inside 0-{clip['seconds']} s of {clip['id']}.")
        items.append({"clip": clip, "in": cin, "out": min(cout, clip["seconds"]), "audio": item.get("audio", item.get("type") != "broll"), "note": item.get("note") or item.get("text") or ""})
    if not items:
        fail('The edit needs "items": a list of {"select": "S012"} or {"clip": "C003", "in": 12.5, "out": 18.0}.')
    W, H = int(edit.get("width") or items[0]["clip"]["width"]), int(edit.get("height") or items[0]["clip"]["height"])
    timebase, ntsc = (int(round(fps)), "TRUE" if fps in (23.976, 29.97, 59.94) else "FALSE")

    def fileurl(path):
        path = os.path.abspath(path).replace("\\", "/")
        if re.match(r"^[A-Za-z]:", path):
            return "file://localhost/" + urllib.parse.quote(path, safe="/:")
        return "file://localhost" + urllib.parse.quote(path, safe="/")

    esc = lambda s: html.escape(str(s), quote=True)
    rate = f"<rate><timebase>{timebase}</timebase><ntsc>{ntsc}</ntsc></rate>"
    video, audio, markers, declared = [], [], [], set()
    pos = 0
    for i, it in enumerate(items, 1):
        c = it["clip"]
        fin, fout = round(it["in"] * fps), round(it["out"] * fps)
        length = max(1, fout - fin)
        dur = max(1, round(c["seconds"] * fps))
        if c["id"] in declared:
            fx = f'<file id="{c["id"]}"/>'
        else:
            declared.add(c["id"])
            aud = f'<audio><samplecharacteristics><samplerate>48000</samplerate><depth>16</depth></samplecharacteristics><channelcount>{c.get("channels") or 2}</channelcount></audio>' if c.get("audio") else ""
            fx = f'<file id="{c["id"]}"><name>{esc(os.path.basename(c["file"]))}</name><pathurl>{esc(fileurl(c["file"]))}</pathurl>{rate}<duration>{dur}</duration><media><video><samplecharacteristics><width>{c["width"]}</width><height>{c["height"]}</height></samplecharacteristics></video>{aud}</media></file>'
        link_v = f"<link><linkclipref>v{i}</linkclipref><mediatype>video</mediatype><trackindex>1</trackindex><clipindex>{i}</clipindex></link>"
        has_audio = c.get("audio") and it["audio"]
        link_a = f"<link><linkclipref>a{i}</linkclipref><mediatype>audio</mediatype><trackindex>1</trackindex><clipindex>{len(audio) + 1}</clipindex><groupindex>1</groupindex></link>" if has_audio else ""
        video.append(f'<clipitem id="v{i}"><name>{esc(os.path.basename(c["file"]))}</name><duration>{dur}</duration>{rate}<start>{pos}</start><end>{pos + length}</end><in>{fin}</in><out>{fout}</out>{fx}{link_v}{link_a}</clipitem>')
        if has_audio:
            audio.append(f'<clipitem id="a{i}"><name>{esc(os.path.basename(c["file"]))}</name><duration>{dur}</duration>{rate}<start>{pos}</start><end>{pos + length}</end><in>{fin}</in><out>{fout}</out><file id="{c["id"]}"/><sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>{link_v}{link_a}</clipitem>')
        if it["note"]:
            markers.append(f"<marker><name>{esc(it['note'][:80])}</name><comment>{esc(it['note'])}</comment><in>{pos}</in><out>-1</out></marker>")
        it["start"], it["length"] = pos, length
        pos += length
    xml = (f'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence id="seq1"><name>{esc(name)}</name><duration>{pos}</duration>{rate}'
           f'<timecode>{rate}<string>01:00:00:00</string><frame>{timebase * 3600}</frame><displayformat>NDF</displayformat></timecode>'
           f'<media><video><format><samplecharacteristics>{rate}<width>{W}</width><height>{H}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format><track>{"".join(video)}</track></video>'
           f'<audio><numOutputChannels>2</numOutputChannels><track>{"".join(audio)}</track></audio></media>{"".join(markers)}</sequence></xmeml>\n')
    base = os.path.join(a.out, name.lower())
    with open(base + ".xml", "w", encoding="utf-8") as fh:
        fh.write(xml)
    # CMX3600 EDL (video + both audio channels), timeline starting at 01:00:00:00.
    edl = [f"TITLE: {name}", "FCM: NON-DROP FRAME", ""]
    for i, it in enumerate(items, 1):
        c = it["clip"]
        src_in, src_out = round(it["in"] * fps), round(it["in"] * fps) + it["length"]
        rec_in, rec_out = timebase * 3600 + it["start"], timebase * 3600 + it["start"] + it["length"]
        track = "B" if (c.get("audio") and it["audio"]) else "V"
        edl.append(f"{i:03d}  AX       {track:<5} C        {tc(src_in, fps)} {tc(src_out, fps)} {tc(rec_in, fps)} {tc(rec_out, fps)}")
        edl.append(f"* FROM CLIP NAME: {os.path.basename(c['file'])}")
        edl.append(f"* SOURCE FILE: {c['file']}")
        if it["note"]:
            edl.append(f"* COMMENT: {it['note'][:120]}")
        edl.append("")
    with open(base + ".edl", "w", encoding="utf-8") as fh:
        fh.write("\n".join(edl))
    # FCPXML 1.10 for Final Cut Pro.
    fd = Fraction(1001, round(fps * 1000)) if ntsc == "TRUE" else Fraction(1, timebase)
    rt = lambda frames: f"{(fd * frames).numerator}/{(fd * frames).denominator}s" if (fd * frames).denominator != 1 else f"{(fd * frames).numerator}s"
    assets, spine = [], []
    for c in {it["clip"]["id"]: it["clip"] for it in items}.values():
        assets.append(f'<asset id="{c["id"]}" name="{esc(os.path.basename(c["file"]))}" start="0s" duration="{rt(round(c["seconds"] * fps))}" hasVideo="1" hasAudio="{1 if c.get("audio") else 0}" format="r1"><media-rep kind="original-media" src="{esc(fileurl(c["file"]).replace("file://localhost", "file://"))}"/></asset>')
    for it in items:
        spine.append(f'<asset-clip ref="{it["clip"]["id"]}" offset="{rt(it["start"])}" start="{rt(round(it["in"] * fps))}" duration="{rt(it["length"])}" name="{esc(os.path.basename(it["clip"]["file"]))}"/>')
    fcpxml = (f'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10"><resources><format id="r1" frameDuration="{rt(1)}" width="{W}" height="{H}"/>{"".join(assets)}</resources>'
              f'<library><event name="{esc(name)}"><project name="{esc(name)}"><sequence format="r1" duration="{rt(pos)}" tcStart="0s" tcFormat="NDF"><spine>{"".join(spine)}</spine></sequence></project></event></library></fcpxml>\n')
    with open(base + ".fcpxml", "w", encoding="utf-8") as fh:
        fh.write(fcpxml)
    # A small preview of the cut, to watch before opening the editor.
    preview = base + "-preview.mp4"
    inputs, parts = [], []
    pw = 960 if W >= H else 540
    ph = int(round(pw * H / W / 2) * 2)
    for i, it in enumerate(items):
        inputs += ["-ss", f"{it['in']:.3f}", "-t", f"{it['length'] / fps:.3f}", "-i", it["clip"]["file"]]
        a_src = f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:{it['length'] / fps:.3f}" if (it["clip"].get("audio") and it["audio"]) else f"anullsrc=r=48000:cl=stereo,atrim=0:{it['length'] / fps:.3f}"
        parts.append(f"[{i}:v]scale={pw}:{ph}:force_original_aspect_ratio=decrease,pad={pw}:{ph}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps}[v{i}];{a_src}[a{i}]")
    graph = ";".join(parts) + ";" + "".join(f"[v{i}][a{i}]" for i in range(len(items))) + f"concat=n={len(items)}:v=1:a=1[v][a]"
    r = subprocess.run([FFMPEG, "-y", "-v", "error", *inputs, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", preview], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"Preview not made: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'ffmpeg error'}")
        preview = None
    cut = [f"# {name}", "", f"{len(items)} pieces, {hms(pos / fps)} at {fps} fps, {W}x{H}.", "", "| # | Timeline | Clip | Source in-out | Note |", "| - | -------- | ---- | ------------- | ---- |"]
    cut += [f"| {i} | {tc(timebase * 3600 + it['start'], fps)} | {it['clip']['name']} | {hms(it['in'])}-{hms(it['out'])} | {it['note'].replace('|', '/')} |" for i, it in enumerate(items, 1)]
    with open(base + "-cutlist.md", "w", encoding="utf-8") as fh:
        fh.write("\n".join(cut) + "\n")
    print(json.dumps({"premiere_davinci_xml": base + ".xml", "final_cut_fcpxml": base + ".fcpxml", "edl": base + ".edl", "cutlist": base + "-cutlist.md", "preview": preview, "pieces": len(items), "length": hms(pos / fps)}, indent=1))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("command", choices=["inventory", "transcribe", "selects", "export"])
    ap.add_argument("--footage")
    ap.add_argument("--out", default="rough-cut/work")
    ap.add_argument("--language", default="")
    ap.add_argument("--model")
    ap.add_argument("--keywords", default="")
    ap.add_argument("--edit")
    ap.add_argument("--fps", type=float, default=25)
    ap.add_argument("--name", default="ROUGH_CUT")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    if a.command == "inventory":
        if not a.footage:
            fail("Use --footage <folder>.")
        cmd_inventory(a)
    elif a.command == "transcribe":
        cmd_transcribe(a)
    elif a.command == "selects":
        cmd_selects(a)
    else:
        if not a.edit:
            fail("Use --edit <edit.json>.")
        cmd_export(a)


if __name__ == "__main__":
    main()

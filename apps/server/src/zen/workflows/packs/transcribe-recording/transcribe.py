"""Zen Staff transcriber: speech to text with faster-whisper, on this computer.

Usage: whisper-python transcribe.py <recording> [--language NAME] [--model DIR] [--out FILE]
"""
import argparse
import os
import sys
import time

LANGUAGES = {
    "romanian": "ro", "english": "en", "hungarian": "hu", "german": "de",
    "french": "fr", "italian": "it", "spanish": "es",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("recording")
    parser.add_argument("--language", default="")
    parser.add_argument("--model", default=os.environ.get("ZEN_WHISPER_MODEL_BASE", ""))
    parser.add_argument("--out", default="")
    args = parser.parse_args()
    if not os.path.isfile(args.recording):
        print(f"ERROR: {args.recording} was not found.")
        return 1
    if not args.model or not os.path.isdir(args.model):
        print("ERROR: the speech model is not prepared. Start the task from Zen Staff.")
        return 1
    from faster_whisper import WhisperModel

    language = LANGUAGES.get(args.language.strip().lower())
    started = time.time()
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(args.recording, language=language, vad_filter=True)
    out = args.out or os.path.join(os.path.dirname(os.path.abspath(args.recording)), "transcript.md")
    with open(out, "w", encoding="utf-8") as handle:
        handle.write(f"# Transcript of {os.path.basename(args.recording)}\n\n")
        for segment in segments:
            minutes, seconds = divmod(int(segment.start), 60)
            handle.write(f"[{minutes:02d}:{seconds:02d}] {segment.text.strip()}\n\n")
    print(f"Done: {out} (language {info.language}, {info.duration:.0f} s of audio, {time.time() - started:.0f} s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

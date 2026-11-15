"""Reads the text of scans, photos and PDFs on this computer (Tesseract, Romanian + English).

    "$ZEN_TOOL_OCR_PYTHON" ocr.py --in <file or folder> --out ocr [--lang ron+eng]

For every document it writes:
  ocr/<name>.json   pages -> lines -> words, each with a confidence 0-100
  ocr/<name>.txt    the text; words read with low confidence look like [?word]
  ocr/<name>-p<N>.jpg  a straightened, readable preview of each page (to look at)
A PDF page that already has text (a digital invoice) is read from that text, confidence 100.
"""

import argparse
import json
import math
import os
import sys

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp", ".gif"}
LOW = 70


def fail(message):
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


try:
    import pypdfium2 as pdfium
    import tesserocr
    from PIL import Image, ImageOps
except ImportError as error:  # pragma: no cover
    fail(f"The OCR tools are not prepared ({error}). Start the task from Zen Staff.")


def tessdata_dir():
    configured = os.environ.get("ZEN_TESSDATA")
    if configured and os.path.isdir(configured):
        return configured
    guess = os.path.normpath(os.path.join(sys.prefix, "..", "tessdata"))
    if os.path.isdir(guess):
        return guess
    fail("The language data is not prepared (ZEN_TESSDATA). Start the task from Zen Staff.")


def documents(target):
    if os.path.isfile(target):
        return [target]
    if not os.path.isdir(target):
        fail(f"{target} does not exist.")
    found = []
    for root, _dirs, files in os.walk(target):
        for name in sorted(files):
            ext = os.path.splitext(name)[1].lower()
            if ext in IMAGE_EXT or ext == ".pdf":
                found.append(os.path.join(root, name))
            elif ext in {".heic", ".heif"}:
                print(f"SKIPPED: {name} is HEIC; save it as JPG on the phone or computer and run again.")
    return sorted(found)


def prepare(image):
    """Phone photo or scan -> upright, grey, large enough, even contrast."""
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("L", "RGB"):
        image = image.convert("RGB")
    grey = ImageOps.grayscale(image)
    width, height = grey.size
    longest = max(width, height)
    if longest < 2000:
        scale = 2000 / longest
        grey = grey.resize((round(width * scale), round(height * scale)), Image.LANCZOS)
    elif longest > 4200:
        scale = 4200 / longest
        grey = grey.resize((round(width * scale), round(height * scale)), Image.LANCZOS)
    return ImageOps.autocontrast(grey, cutoff=1)


def deskew(api, image):
    """Straightens a slightly tilted photo, with the tilt Tesseract measures on the text lines."""
    api.SetPageSegMode(tesserocr.PSM.AUTO)
    api.SetImage(image)
    layout = api.AnalyseLayout()
    if layout is None:
        return image, 0.0
    angle = round(math.degrees(layout.Orientation()[3]), 2)
    if abs(angle) < 0.3 or abs(angle) > 15:
        return image, 0.0
    return image.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=255), angle


def recognize(api, image):
    api.SetImage(image)
    api.Recognize()
    iterator = api.GetIterator()
    lines = []
    level_line = tesserocr.RIL.TEXTLINE
    level_word = tesserocr.RIL.WORD
    current = None
    for word in tesserocr.iterate_level(iterator, level_word):
        text = word.GetUTF8Text(level_word)
        if not text or not text.strip():
            continue
        conf = round(word.Confidence(level_word), 1)
        starts_line = word.IsAtBeginningOf(level_line)
        if current is None or starts_line:
            box = word.BoundingBox(level_line)
            current = {"text": "", "conf": 0, "bbox": list(box) if box else None, "words": []}
            lines.append(current)
        current["words"].append({"text": text.strip(), "conf": conf})
    for line in lines:
        words = line["words"]
        line["text"] = " ".join(w["text"] for w in words)
        line["conf"] = round(sum(w["conf"] for w in words) / len(words), 1)
    return lines


def mean_conf(lines):
    words = [w["conf"] for line in lines for w in line["words"]]
    return round(sum(words) / len(words), 1) if words else 0.0


def good_words(lines):
    return sum(1 for line in lines for w in line["words"] if w["conf"] >= LOW)


def upright(api, image):
    """The page turned the way that reads best (phone photos are often sideways)."""
    small = image.copy()
    small.thumbnail((1400, 1400))
    api.SetPageSegMode(tesserocr.PSM.SINGLE_BLOCK)
    scores = []
    for angle in (0, 90, 180, 270):
        scores.append((good_words(recognize(api, small.rotate(angle, expand=True))), -angle, angle))
    angle = max(scores)[2]
    return (image.rotate(angle, expand=True) if angle else image), angle


def read_page(api, image):
    """Reads in line modes (columns, one block) and keeps the richer one; a sparse pass adds
    the words the line modes missed (amounts in boxes, stamps)."""
    image, angle = upright(api, image)
    image, tilt = deskew(api, image)
    passes = {}
    for name, mode in (("column", tesserocr.PSM.SINGLE_COLUMN), ("block", tesserocr.PSM.SINGLE_BLOCK)):
        api.SetPageSegMode(mode)
        passes[name] = recognize(api, image)
    best = max(passes, key=lambda name: good_words(passes[name]))
    lines = passes[best]
    api.SetPageSegMode(tesserocr.PSM.SPARSE_TEXT)
    sparse = recognize(api, image)
    seen = {w["text"] for line in lines for w in line["words"]}
    extra = [w for line in sparse for w in line["words"] if w["text"] not in seen and w["conf"] >= 40]
    return image, lines, extra, angle, best, tilt


def mark(word):
    return word["text"] if word["conf"] >= LOW else f"[?{word['text']}]"


def text_with_marks(page):
    out = [" ".join(mark(w) for w in line["words"]) for line in page["lines"]]
    if page.get("extra_words"):
        out.append("--- also read on the page (sparse reading, no line order) ---")
        out.append(" ".join(mark(w) for w in page["extra_words"]))
    return "\n".join(out)


def pdf_pages(path):
    try:
        pdf = pdfium.PdfDocument(path)
    except Exception as error:  # noqa: BLE001
        print(f"SKIPPED: {os.path.basename(path)} could not be opened as PDF ({error}).")
        return
    for index in range(len(pdf)):
        page = pdf[index]
        text = page.get_textpage().get_text_range().strip()
        bitmap = page.render(scale=300 / 72)
        yield index + 1, bitmap.to_pil(), text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="target", required=True)
    parser.add_argument("--out", default="ocr")
    parser.add_argument("--lang", default="ron+eng")
    args = parser.parse_args()

    files = documents(args.target)
    if not files:
        fail(f"No images or PDFs found in {args.target} (JPG, PNG, TIFF, WEBP, PDF).")
    os.makedirs(args.out, exist_ok=True)
    summary = []
    with tesserocr.PyTessBaseAPI(path=tessdata_dir(), lang=args.lang) as api:
        api.SetVariable("preserve_interword_spaces", "1")
        for path in files:
            base = os.path.splitext(os.path.basename(path))[0]
            pages = []
            if path.lower().endswith(".pdf"):
                source_pages = list(pdf_pages(path))
            else:
                try:
                    source_pages = [(1, Image.open(path), "")]
                except Exception as error:  # noqa: BLE001
                    print(f"SKIPPED: {os.path.basename(path)} is not an image I can read ({error}).")
                    continue
            for number, image, layer_text in source_pages:
                preview_path = os.path.join(args.out, f"{base}-p{number}.jpg")
                if len(layer_text) > 80:
                    lines = [
                        {
                            "text": raw.strip(),
                            "conf": 100.0,
                            "bbox": None,
                            "words": [{"text": t, "conf": 100.0} for t in raw.split()],
                        }
                        for raw in layer_text.splitlines()
                        if raw.strip()
                    ]
                    page = {"page": number, "source": "pdf-text", "rotated": 0, "lines": lines}
                    preview = ImageOps.exif_transpose(image).convert("RGB")
                else:
                    straight, lines, extra, angle, mode, tilt = read_page(api, prepare(image))
                    page = {
                        "page": number,
                        "source": "ocr",
                        "mode": mode,
                        "rotated": angle,
                        "straightened": tilt,
                        "lines": lines,
                        "extra_words": extra,
                    }
                    preview = straight.convert("RGB")
                page["mean_conf"] = mean_conf(page["lines"])
                page["low_words"] = sum(1 for l in page["lines"] for w in l["words"] if w["conf"] < LOW)
                preview.thumbnail((1600, 1600))
                preview.save(preview_path, "JPEG", quality=82)
                page["preview"] = os.path.abspath(preview_path)
                pages.append(page)
            if not pages:
                continue
            result = {"file": os.path.abspath(path), "lang": args.lang, "pages": pages}
            with open(os.path.join(args.out, f"{base}.json"), "w", encoding="utf-8") as handle:
                json.dump(result, handle, ensure_ascii=False, indent=1)
            with open(os.path.join(args.out, f"{base}.txt"), "w", encoding="utf-8") as handle:
                for page in pages:
                    if len(pages) > 1:
                        handle.write(f"--- page {page['page']} ---\n")
                    handle.write(text_with_marks(page) + "\n")
            confidence = min(p["mean_conf"] for p in pages)
            summary.append(
                {
                    "file": os.path.basename(path),
                    "pages": len(pages),
                    "mean_conf": confidence,
                    "low_words": sum(p["low_words"] for p in pages),
                    "json": os.path.abspath(os.path.join(args.out, f"{base}.json")),
                    "txt": os.path.abspath(os.path.join(args.out, f"{base}.txt")),
                    "previews": [p["preview"] for p in pages],
                }
            )
            quality = "good" if confidence >= 80 else "fair" if confidence >= 60 else "POOR (ask for a better photo)"
            print(f"OK: {os.path.basename(path)}: {len(pages)} page(s), confidence {confidence} ({quality})")
    with open(os.path.join(args.out, "ocr-summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=1)
    print(f"Wrote {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()

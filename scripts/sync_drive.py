"""Crawl the public Google Drive recipe folder and build the site's data.

Writes <out>/data/recipes.json and <out>/img/<id>.webp / <id>-full.webp.
Usage: python scripts/sync_drive.py --out site [--cache .cache]
"""
import argparse
import html
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

import docx
from PIL import Image

ROOT_FOLDER_ID = "1iHpZwhDNF6wzUG-0oQiZjrMRO2ufUtmi"
LIST_URL = "https://drive.google.com/embeddedfolderview?id={}"
DOWNLOAD_URL = "https://drive.google.com/uc?export=download&id={}"
GDOC_EXPORT_URL = "https://docs.google.com/document/d/{}/export?format=docx"

ENTRY_RE = re.compile(
    r'<a href="https://(?:drive|docs)\.google\.com/(?:drive/folders/|file/d/|document/d/)([A-Za-z0-9_-]+)[^"]*"'
    r'[^>]*>.*?<div class="flip-entry-title">([^<]*)</div>',
    re.S,
)
URL_RE = re.compile(r"https?://\S+")
SECTION_INGREDIENTS = "מצרכים"
SECTION_STEPS = "אופן הכנה"
SECTION_LINK = "קישור"
SUBSTITUTIONS = "החלפות"
SECTION_NOTES = "הערות"


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def fetch(url, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (recipe-site-sync)"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except Exception as e:  # noqa: BLE001
            if attempt == tries - 1:
                raise
            wait = 2 ** attempt
            log(f"  retry {url} in {wait}s ({e})")
            time.sleep(wait)


def list_folder(folder_id):
    """Return (folders, files); files are (id, name, kind) where kind is "gdoc" or a MIME type."""
    page = fetch(LIST_URL.format(folder_id)).decode("utf-8", "replace")
    folders, files = [], []
    for m in ENTRY_RE.finditer(page):
        href = m.group(0)
        item_id, name = m.group(1), html.unescape(m.group(2)).strip()
        if "/folders/" in href:
            folders.append((item_id, name))
        elif "/document/d/" in href or "application/vnd.google-apps.document" in href:
            files.append((item_id, name, "gdoc"))
        else:
            mime = re.search(r"/type/([^\"]+)\"", href)
            files.append((item_id, name, mime.group(1) if mime else "file"))
    return folders, files


def split_folder_name(name):
    if " - " in name:
        cat, kash = name.split(" - ", 1)
        return cat.strip(), kash.strip()
    return name.strip(), ""


def crawl():
    """Yield (file_id, name, kind, category, kashrut)."""
    root_folders, root_files = list_folder(ROOT_FOLDER_ID)
    if not root_folders and not root_files:
        raise SystemExit("Root Drive listing parsed to zero entries - refusing to build an empty site.")
    for fid, name, kind in root_files:
        yield fid, name, kind, "", ""
    stack = [(fid, *split_folder_name(name)) for fid, name in root_folders]
    while stack:
        folder_id, cat, kash = stack.pop()
        sub_folders, files = list_folder(folder_id)
        log(f"{cat} / {kash or '-'}: {len(files)} files")
        for fid, name, kind in files:
            yield fid, name, kind, cat, kash
        # Nested folders inherit the parent's labels.
        stack.extend((sfid, cat, kash) for sfid, _ in sub_folders)


def download(file_id, kind, cache_dir):
    path = cache_dir / f"{file_id}.docx" if cache_dir else None
    if path and path.exists():
        return path.read_bytes()
    url = GDOC_EXPORT_URL.format(file_id) if kind == "gdoc" else DOWNLOAD_URL.format(file_id)
    data = fetch(url)
    if not data.startswith(b"PK"):
        raise ValueError("download is not a .docx (maybe Drive returned an HTML page)")
    if path:
        path.write_bytes(data)
    return data


def para_links(p):
    """Hyperlink targets in a paragraph (relationship links + plain-text URLs)."""
    links = []
    for h in p._p.xpath(".//w:hyperlink"):
        rid = h.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        if rid and rid in p.part.rels:
            links.append(p.part.rels[rid].target_ref)
    links += URL_RE.findall(p.text)
    for instr in p._p.xpath(".//w:instrText"):
        links += URL_RE.findall(instr.text or "")
    return [l.strip('"') for l in links]


def para_text(p):
    """Full paragraph text, including runs inside content controls (w:sdt) that p.text skips."""
    return re.sub(r"\s+", " ", "".join(t.text or "" for t in p._p.xpath(".//w:t"))).strip()


def section_of(text):
    t = text.strip(" :")
    if t in ("מצרכים", "מרכיבים", "חומרים"):
        return SECTION_INGREDIENTS
    if t in ("אופן הכנה", "אופן ההכנה", "הכנה", "להכנה", "הוראות הכנה", "שלבי הכנה"):
        return SECTION_STEPS
    if t.startswith(SECTION_LINK) or t in ("מקור", "לינק"):
        return SECTION_LINK
    return None


def fold_empty_groups(groups):
    """Headings with no items under them were really list lines styled as headings: make them items."""
    out = []
    for g in groups:
        if g["items"]:
            out.append(g)
        elif out and not out[-1]["heading"] and out[-1].get("_folded"):
            out[-1]["items"].append(g["heading"])
        else:
            out.append({"heading": "", "items": [g["heading"]], "_folded": True})
    for g in out:
        g.pop("_folded", None)
    return out


def parse_docx(data, fallback_title):
    d = docx.Document(io.BytesIO(data))
    title = ""
    section = None
    ingredients, substitutions, steps, links, notes = [], [], [], [], []
    group = None
    in_subs = False

    def add(lst, text):
        nonlocal group
        if group is None or lst is not group[1]:
            group = ({"heading": "", "items": []}, lst)
            lst.append(group[0])
        group[0]["items"].append(text)

    for p in d.paragraphs:
        text = para_text(p)
        style = (p.style.name if p.style is not None else "") or ""
        is_heading = style.startswith("Heading") or style == "Title"
        links += para_links(p) if section == SECTION_LINK or URL_RE.search(text) else []
        if not text:
            continue
        known = section_of(text)
        if known and style.startswith("Heading") and style != "Heading 1" and section is not None:
            known = None  # e.g. a "להכנה" Heading 2 inside מצרכים is a group, not the steps section
        if not title and not known and (is_heading or section is None):
            title = text
            continue
        if is_heading and text.strip(" :") == SUBSTITUTIONS:
            in_subs, group = True, None
            continue
        if known:
            section, group, in_subs = known, None, False
            continue
        if is_heading:
            in_subs = False
            if style == "Heading 1" and text.strip(" :") in ("הערות", "טיפים", "הערה"):
                section, group = SECTION_NOTES, None
                continue
            target = ingredients if section == SECTION_INGREDIENTS else steps if section == SECTION_STEPS else None
            if target is not None:
                grp = {"heading": text, "items": []}
                target.append(grp)
                group = (grp, target)
            continue
        if section == SECTION_LINK:
            if not URL_RE.search(text):
                notes.append(text)
            continue
        if in_subs:
            substitutions.append(text)
        elif section == SECTION_INGREDIENTS:
            add(ingredients, text)
        elif section == SECTION_STEPS:
            add(steps, text)
        elif URL_RE.fullmatch(text):
            continue
        else:
            notes.append(text)

    ingredients = fold_empty_groups(ingredients)
    steps = fold_empty_groups(steps)

    image = None
    for rel in d.part.rels.values():
        if "image" in rel.reltype and not rel.is_external:
            image = rel.target_part.blob
            break

    source = next((l for l in links if l.startswith("http")), None)
    return {
        "title": title or fallback_title,
        "ingredients": ingredients,
        "substitutions": substitutions,
        "steps": steps,
        "notes": notes,
        "sourceUrl": source,
    }, image


def save_images(blob, file_id, img_dir):
    im = Image.open(io.BytesIO(blob))
    im = im.convert("RGB")
    try:
        from PIL import ImageOps
        im = ImageOps.exif_transpose(im)
    except Exception:  # noqa: BLE001
        pass
    out = {}
    for suffix, size in (("", 600), ("-full", 1400)):
        copy = im.copy()
        copy.thumbnail((size, size))
        name = f"{file_id}{suffix}.webp"
        copy.save(img_dir / name, "WEBP", quality=82)
        out[suffix] = f"img/{name}"
    return out[""], out["-full"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site")
    ap.add_argument("--cache", default=None, help="folder to cache downloaded .docx files")
    args = ap.parse_args()

    out = Path(args.out)
    data_dir, img_dir = out / "data", out / "img"
    data_dir.mkdir(parents=True, exist_ok=True)
    img_dir.mkdir(parents=True, exist_ok=True)
    for old in img_dir.glob("*.webp"):
        old.unlink()
    cache = Path(args.cache) if args.cache else None
    if cache:
        cache.mkdir(parents=True, exist_ok=True)

    recipes, failures = [], 0
    seen = set()
    for fid, name, kind, cat, kash in crawl():
        if fid in seen:
            continue
        seen.add(fid)
        is_word = kind == "gdoc" or "wordprocessingml" in kind or name.lower().endswith(".docx")
        if not is_word:
            log(f"  skip (not .docx): {name}")
            continue
        fallback = re.sub(r"\.docx$", "", name, flags=re.I)
        try:
            recipe, image = parse_docx(download(fid, kind, cache), fallback)
        except Exception as e:  # noqa: BLE001
            failures += 1
            log(f"  WARNING: could not parse {name}: {e}")
            continue
        thumb = full = None
        if image:
            try:
                thumb, full = save_images(image, fid, img_dir)
            except Exception as e:  # noqa: BLE001
                log(f"  WARNING: bad image in {name}: {e}")
        recipes.append({
            "id": fid,
            "title": recipe["title"],
            "category": cat,
            "kashrut": kash,
            "image": thumb,
            "imageFull": full,
            "ingredients": recipe["ingredients"],
            "substitutions": recipe["substitutions"],
            "steps": recipe["steps"],
            "notes": recipe["notes"],
            "sourceUrl": recipe["sourceUrl"],
            "driveUrl": f"https://drive.google.com/file/d/{fid}/view",
        })

    if not recipes:
        raise SystemExit("No recipes parsed - refusing to build an empty site.")
    recipes.sort(key=lambda r: r["title"])
    payload = {"updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "recipes": recipes}
    (data_dir / "recipes.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"Done: {len(recipes)} recipes, {sum(1 for r in recipes if r['image'])} with photos, {failures} failed.")


if __name__ == "__main__":
    main()

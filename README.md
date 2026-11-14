# Reciplease 🍲

A searchable website for the family recipe collection that lives in Google Drive
([מתכונים folder](https://drive.google.com/drive/folders/1iHpZwhDNF6wzUG-0oQiZjrMRO2ufUtmi)).

**Live site:** https://eschulden.github.io/reciplease/

## How it works

1. A GitHub Actions workflow (`.github/workflows/deploy.yml`) runs **every 3 hours**, on every push,
   and on demand.
2. `scripts/sync_drive.py` reads the public Drive folder, with no API key. It downloads every Word
   recipe, reads its title, ingredients, substitutions, steps, notes, source link and photo, and writes
   `site/data/recipes.json` plus resized photos in `site/img/`.
3. The static site in `site/` (plain HTML/CSS/JS) is deployed to GitHub Pages for free.

Generated data is not committed. Every run rebuilds it from Drive, so recipes that are added, edited,
moved or deleted on Drive show up on the site after the next run.

## Adding recipes

Drop a `.docx` (or Google Doc) into the right subfolder on Drive. Subfolders are named
`<dish type> - <kashrut>`, e.g. `סלטים - חלבי`, and that name sets the recipe's filters. A new subfolder,
e.g. `מאפים - חלבי`, automatically adds a new filter chip.

The recipe's photo is the first picture inside the Word document.

### Want it on the site right now?
GitHub → **Actions** → *Sync recipes from Drive and deploy* → **Run workflow**, or:

```bash
gh workflow run deploy.yml
```

## Run locally

```bash
pip install -r scripts/requirements.txt
python scripts/sync_drive.py --out site --cache .cache
python -m http.server 8124 --directory site
```

Then open http://localhost:8124.

## Note
GitHub pauses scheduled workflows in a repo that has had no activity for 60 days. If that happens, open
the Actions tab and click **Enable workflow**. Any push or manual run also brings it back.

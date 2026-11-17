"""Regenerate the committed marketing font subsets with fonttools[woff]==4.63.0.

Run from any directory: python scripts/subset-landing-fonts.py
The editor keeps the complete fonts for user documents. Marketing only needs
Latin text and common punctuation; variable weights and layout features remain.
"""

from pathlib import Path

from fontTools import subset
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
copy = (ROOT / "docs/index.html").read_text(encoding="utf-8") + (ROOT / "docs/landing.css").read_text(encoding="utf-8")
characters = set(range(0x20, 0x7F)) | {ord(character) for character in copy}
for name, weights in (("geist", (400, 400, 700)), ("newsreader", (450, 450, 550)), ("geist-mono", 400)):
    options = subset.Options()
    options.flavor = "woff2"
    font = subset.load_font(ROOT / "packages/tokens/node_modules/@fontsource-variable" / name / "files" / f"{name}-latin-wght-normal.woff2", options)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=characters)
    subsetter.subset(font)
    instantiateVariableFont(font, {"wght": weights}, inplace=True)
    subset.save_font(font, ROOT / "docs/assets/fonts" / f"{name}.woff2", options)

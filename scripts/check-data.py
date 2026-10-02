#!/usr/bin/env python3
"""Pre-publish guard for the portfolio datasets.

Scans every string in the given JSON files for things that must never reach a public
GitHub Pages site (local paths, e-mail addresses, URLs, credential words, the employer's
name, AI-assistant mentions) and checks the project-card schema. Private patterns come from
scripts/denylist.local when it exists.

    python3 scripts/check-data.py assets/data/projects.json sarkai/assets/data/*.json

Exit status is non-zero when anything is flagged, so it can run in CI or a git hook.
"""
import json
import re
import sys

BANNED = {
    "windows path": r"\b[A-Za-z]:\\|\\Users\\|/Users/|/home/\w+",
    "e-mail address": r"[\w.+-]+@[\w-]+\.[\w.-]+",
    "url / host": r"https?://|\bwww\.|\blocalhost\b|\b127\.0\.0\.1\b|\b0\.0\.0\.0\b|\.(?:com|net|org|io|ai)\b/",
    "port number": r":\d{4,5}\b",
    "credential word": r"\bpassw(?:or)?d|\bsecret\b|\bcredential|\bapi[ _-]?key\b|\bbearer\b|\.env\b|\bplaintext\b|VALID_USERS|HSERAG",
    "tls / auth bypass": r"verify\s*=\s*False|auth bypass|isAuthenticated",
    "AI-assistant mention": r"\bClaude\b|GitHub Copilot|Microsoft Copilot|\bChatGPT\b|AI-generated|vibe[- ]cod",
}
# Private patterns live in scripts/denylist.local (git-ignored on purpose, so the words never
# enter the repository): one regular expression per line, '#' for comments, a leading 'cs:'
# makes a pattern case-sensitive. Lines starting with 'name:' apply to project names only.
def _load_private():
    import pathlib
    f = pathlib.Path(__file__).resolve().parent / "denylist.local"
    cs, ci, name = [], [], []
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("name:"):
                name.append(line[5:])
            elif line.startswith("cs:"):
                cs.append(line[3:])
            else:
                ci.append(line)
    j = lambda xs: "|".join(xs) if xs else r"(?!x)x"
    return j(cs), j(ci), j(name)


INTERNAL_CS, INTERNAL_CI, NAME_BANNED = _load_private()

# Phrases that trip a pattern but are harmless in context.
ALLOW = ("process-secret",)
LIMITS = {
    "tagline": 140, "maturity": 80, "what": 900, "solves": 900, "name": 80,
}


def walk(node, path=""):
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, f"{path}[{i}]")


def main(paths):
    problems = 0
    for p in paths:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
        for where, s in walk(data):
            for ok in ALLOW:
                s = s.replace(ok, "")
            m2 = re.search(INTERNAL_CS, s) or re.search(INTERNAL_CI, s, flags=re.I)
            if m2:
                problems += 1
                print(f"{p}: {where}: internal name: ...{s[max(0, m2.start()-30):m2.end()+30]!r}")
            for label, pat in BANNED.items():
                m = re.search(pat, s, flags=re.I if label != "tls / auth bypass" else 0)
                if m:
                    problems += 1
                    print(f"{p}: {where}: {label}: ...{s[max(0, m.start()-30):m.end()+30]!r}")
        projects = data.get("projects") if isinstance(data, dict) else None
        for pr in projects or []:
            for nm in [pr.get("name", "")] + [x.get("name", "") for x in pr.get("subs", [])]:
                if re.search(NAME_BANNED, nm, flags=re.I):
                    problems += 1
                    print(f"{p}: name contains employer product-line word: {nm!r}")
            for k, lim in LIMITS.items():
                v = pr.get(k)
                if v is not None and len(v) > lim:
                    problems += 1
                    print(f"{p}: {pr.get('id')}.{k}: {len(v)} chars > {lim}")
    print("OK: nothing flagged" if not problems else f"{problems} problem(s) flagged")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["assets/data/projects.json"]))

#!/usr/bin/env bash
# Reproduce every check the README reports. No arguments, no setup.
#
#   ./verify.sh
#
# Needs Node 22+ and Chrome/Chromium/Edge. The house-style PDF checks need
# PyMuPDF, and the Office checks need python-docx / python-pptx to build real
# fixtures — both are skipped with a note when absent, never silently passed.

set -u
cd "$(dirname "$0")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0; skip=0
G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; Z=$'\033[0m'
ok()   { printf "  %sok%s    %s\n"   "$G" "$Z" "$1"; pass=$((pass+1)); }
bad()  { printf "  %sFAIL%s  %s\n"   "$R" "$Z" "$1"; fail=$((fail+1)); }
sk()   { printf "  %sskip%s  %s\n"   "$Y" "$Z" "$1"; skip=$((skip+1)); }
head_() { printf "\n%s\n" "$1"; }

# expect <wanted-exit> <label> -- <command...>
expect() {
  local want="$1" label="$2"; shift 3
  "$@" >"$TMP/out" 2>&1; local got=$?
  if [ "$got" = "$want" ]; then ok "$label"
  else bad "$label ${D}(exit $got, wanted $want)${Z}"; sed 's/^/        /' "$TMP/out" | tail -6; fi
}

# ---------------------------------------------------------------- walkable-3d
head_ "walkable-3d"
expect 0 "audit passes on the bundled scene" -- \
  node walkable-3d/scripts/audit.mjs walkable-3d/assets/template

mkdir -p "$TMP/broken" && cp walkable-3d/assets/template/index.html walkable-3d/assets/template/runtime.js "$TMP/broken/"
cat > "$TMP/broken/scene.json" <<'JSON'
{ "meta": { "name": "broken" }, "spawn": { "position": [0,1.7,0], "lookAt": [0,1.6,-3] },
  "materials": { "w": { "color": "#888" } },
  "objects": [
    { "id":"floor","kind":"box","size":[10,0.1,10],"position":[0,-0.05,0],"material":"w" },
    { "id":"a","kind":"box","size":[2,2,2],"material":"w","solid":true },
    { "id":"b","kind":"box","size":[2,2,2],"material":"w","solid":true },
    { "id":"b","kind":"box","size":[2,2,2],"material":"w","solid":true },
    { "id":"tiny","kind":"box","size":[0.0005,0.0005,0.0005],"position":[3,1,0],"material":"w" } ] }
JSON
expect 2 "audit fails a scene with the player trapped in geometry" -- \
  node walkable-3d/scripts/audit.mjs "$TMP/broken"

node walkable-3d/scripts/shot.mjs walkable-3d/assets/template --out "$TMP/shots" --only spawn >/dev/null 2>&1
[ -s "$TMP/shots/spawn.png" ] && ok "shot.mjs renders a frame headlessly" || bad "shot.mjs produced no image"

# A scene can be structurally perfect and still not hold the player up.
mkdir -p "$TMP/falling" && cp walkable-3d/assets/template/index.html walkable-3d/assets/template/runtime.js "$TMP/falling/"
cat > "$TMP/falling/scene.json" <<'JSON'
{ "meta": { "name": "falling" }, "spawn": { "position": [0, 34, 0], "lookAt": [0, 0, -4] },
  "materials": { "g": { "color": "#6f8455" } },
  "objects": [
    { "id":"ground","kind":"box","size":[40,0.4,40],"position":[0,-0.2,0],"material":"g" },
    { "id":"post","kind":"box","size":[0.4,2,0.4],"position":[3,1,-3],"material":"g","solid":true } ] }
JSON
expect 2 "audit fails a scene that does not hold the player up" -- \
  node walkable-3d/scripts/audit.mjs "$TMP/falling"

node walkable-3d/scripts/shot.mjs walkable-3d/assets/template --out "$TMP/shots" --only spawn --plan 1.5 >/dev/null 2>&1
[ -s "$TMP/shots/plan-1_5.png" ] && ok "--plan cuts through the roof for an interior view" || bad "--plan produced no image"

node walkable-3d/scripts/export-glb.mjs walkable-3d/assets/template --out "$TMP/scene.glb" >/dev/null 2>&1
if node -e '
  const fs=require("fs"),b=fs.readFileSync(process.argv[1]);
  const n=b.readUInt32LE(12), j=JSON.parse(b.subarray(20,20+n));
  const named=j.nodes.filter(x=>x.name).length, parents=j.nodes.filter(x=>x.children).length;
  if(named<40||parents<5) throw new Error(`only ${named} named / ${parents} parents`);
  ' "$TMP/scene.glb" 2>"$TMP/out"; then
  ok "glTF export keeps object names and parenting"
else bad "glTF export lost structure ${D}($(cat "$TMP/out" | tail -1))${Z}"; fi

# --------------------------------------------------------- playable-prototype
head_ "playable-prototype"
expect 0 "the bundled game passes the playtest" -- \
  node playable-prototype/scripts/playtest.mjs playable-prototype/assets/template/game.html

mkdir -p "$TMP/proto"
cat > "$TMP/proto/noapi.html" <<'HTML'
<!doctype html><meta charset=utf-8><canvas></canvas>
HTML
cat > "$TMP/proto/leaky.html" <<'HTML'
<!doctype html><meta charset=utf-8><canvas></canvas><script>
let G={status:'menu',tick:0,score:0,drift:0};
window.__game={actions:['left','right','fire','start'],
 state:()=>({status:G.status,tick:G.tick,score:G.score,drift:G.drift}),
 input(a,d){if(a==='left'&&d)G.drift--;if(a==='right'&&d)G.drift++;if(a==='start'&&d)this.start();},
 start(){G.status='playing';},reset(){G={status:'menu',tick:0,score:0,drift:0};},seed(n){},
 step(n=1){for(let i=0;i<n;i++){G.tick++;G.drift+=Math.random()*0.001;}}};
</script>
HTML
expect 2 "playtest rejects a prototype with no API and one that is non-deterministic" -- \
  node playable-prototype/scripts/playtest.mjs "$TMP/proto" --ticks 600

# A turn-based game advances nothing while no move is pending. That is the
# documented pattern, and the harness used to fail it.
mkdir -p "$TMP/turn"
cat > "$TMP/turn/turn.html" <<'HTML'
<!doctype html><meta charset=utf-8><canvas></canvas><script>
let G={status:'menu',tick:0,score:0,at:0},pending=null;
window.__game={actions:['fwd','back','start'],
 state:()=>({status:G.status,tick:G.tick,score:G.score,at:G.at}),
 input(a,d){if(!d)return;if(a==='start'){if(G.status!=='playing')this.start();}else pending=a;},
 start(){G={status:'playing',tick:0,score:0,at:0};pending=null;},
 reset(){G={status:'menu',tick:0,score:0,at:0};pending=null;},seed(n){},
 step(n=1){for(let i=0;i<n;i++){ if(G.status!=='playing'||!pending)continue;
   const a=pending;pending=null;G.tick++;
   G.at+=(a==='fwd'?1:-1); if(G.at>=3){G.score++;G.at=0;} if(G.at<=-6)G.status='over'; }}};
</script>
HTML
expect 0 "playtest accepts a turn-based prototype that idles without advancing" -- \
  node playable-prototype/scripts/playtest.mjs "$TMP/turn" --ticks 900

# Inputs that change the world but never change the outcome: a prototype with
# no decision in it. The lookahead player cannot beat random, and that is the
# thing a prototyping pass most needs told.
mkdir -p "$TMP/nodepth"
cat > "$TMP/nodepth/nodepth.html" <<'HTML'
<!doctype html><meta charset=utf-8><canvas></canvas><script>
let G={status:'menu',tick:0,score:0,x:0},held={};
window.__game={actions:['left','right','start'],
 state:()=>({status:G.status,tick:G.tick,score:G.score,x:G.x}),
 input(a,d){if(a==='start'){if(d&&G.status!=='playing')this.start();}else held[a]=d;},
 start(){G={status:'playing',tick:0,score:0,x:0};},
 reset(){G={status:'menu',tick:0,score:0,x:0};for(const k in held)held[k]=false;},seed(n){},
 step(n=1){for(let i=0;i<n;i++){ if(G.status!=='playing')continue; G.tick++;
   if(held.left)G.x--; if(held.right)G.x++;      // moves, but nothing depends on it
   if(G.tick%30===0)G.score++;                   // score arrives on its own
   if(G.tick>=600)G.status='over'; }}};
</script>
HTML
node playable-prototype/scripts/playtest.mjs "$TMP/nodepth" --ticks 600 --seeds 3 >"$TMP/out" 2>&1
grep -q '\[depth\]' "$TMP/out" && ok "playtest flags a prototype whose inputs carry no decision" || { bad "depth check did not fire"; sed 's/^/        /' "$TMP/out" | tail -6; }

# ---------------------------------------------------------------- frontend-qa
head_ "frontend-qa"
mkdir -p "$TMP/clean" "$TMP/flawed"
printf '%s' '<!doctype html><meta charset=utf-8><title>Clean</title><style>body{margin:0;font:16px system-ui;padding:24px}button{min-width:48px;min-height:48px}</style><h1>Clean</h1><h2>Section</h2><p>Fine.</p><button>Continue</button>' > "$TMP/clean/index.html"
printf '%s' '<!doctype html><meta charset=utf-8><style>.wide{width:1700px;height:40px}</style><h1>Shop</h1><h4>Jump</h4><div class=wide>x</div><img src="/missing.png"><button><svg width=20 height=20></svg></button><a href="#">click</a><form><input type=email></form><div id=d></div><div id=d></div><script>undefinedFunction()</script>' > "$TMP/flawed/index.html"
expect 0 "sweep passes a clean page" -- \
  node frontend-qa/scripts/qa-run.mjs "$TMP/clean" --out "$TMP/qa1" --widths 1440
expect 2 "sweep catches console errors, overflow, broken images and duplicate ids" -- \
  node frontend-qa/scripts/qa-run.mjs "$TMP/flawed" --out "$TMP/qa2" --widths 390,1440

# No viewport meta means the phone lays the page out at ~980px and every other
# width measurement in the report is taken in a viewport that isn't on screen.
mkdir -p "$TMP/novp"
printf '%s' '<!doctype html><meta charset=utf-8><title>No viewport</title><style>body{margin:0;font:16px system-ui}</style><h1>Hi</h1><p>No viewport meta here.</p>' > "$TMP/novp/index.html"
node frontend-qa/scripts/qa-run.mjs "$TMP/novp" --out "$TMP/qa3" --widths 390 >"$TMP/out" 2>&1
grep -q 'viewport' "$TMP/out" && ok "sweep flags a page with no viewport meta" || { bad "viewport check did not fire"; sed 's/^/        /' "$TMP/out" | tail -5; }

# Contrast and focus visibility: both computable, both commonly assumed not to be.
mkdir -p "$TMP/a11y"
cat > "$TMP/a11y/index.html" <<'HTML'
<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>a11y fixture</title>
<style>body{margin:0;font:16px system-ui;background:#fff;color:#111}
 .faint{color:#adb5bd} .ok{color:#3d4852}
 button.bare{outline:none;border:1px solid #ccc;background:#eee;padding:10px 14px}
 button.good:focus{outline:3px solid #2b6cb0}</style>
<h1 class=ok>Heading</h1><p class=faint>Too light to read.</p><p class=ok>Fine.</p>
<button class=bare>No focus ring</button><button class=good>Has a focus ring</button>
HTML
node frontend-qa/scripts/qa-run.mjs "$TMP/a11y" --out "$TMP/qa4" --widths 1440 >"$TMP/out" 2>&1
grep -q 'contrast.*p.faint' "$TMP/out" && ok "sweep computes colour contrast and flags text below AA" \
  || { bad "contrast check did not fire"; sed 's/^/        /' "$TMP/out" | tail -6; }
grep -q 'button.bare' "$TMP/out" && ! grep -q 'button.good' "$TMP/out" \
  && ok "sweep flags a control with no focus style, and not one that has one" \
  || { bad "focus-visibility check wrong"; sed 's/^/        /' "$TMP/out" | tail -6; }

# ---------------------------------------------------------------- house-style
head_ "house-style ${D}(style.py runs on the standard library alone)${Z}"
if python3 -c "import fitz" 2>/dev/null; then
  python3 - "$TMP" <<'PY'
import sys, fitz
T = sys.argv[1]
d = fitz.open(); p = d.new_page(width=612, height=792)
p.insert_text((72,100), "Quarterly Review", fontname="helv", fontsize=24, color=(0.12,0.29,0.49))
p.insert_text((72,140), "Body copy.", fontname="helv", fontsize=11); d.save(f"{T}/ref.pdf")
d = fitz.open(); q = d.new_page(width=612, height=792)
q.insert_text((72,100), "Quarterly Review", fontname="tibo", fontsize=31, color=(0.85,0.11,0.13))
q.insert_text((72,140), "Drifted.", fontname="tibo", fontsize=13); d.save(f"{T}/drift.pdf")
PY
  python3 house-style/scripts/style.py extract "$TMP/ref.pdf" -o "$TMP/pdf.json" >/dev/null 2>&1
  expect 0 "pdf: the reference matches its own spec" -- \
    python3 house-style/scripts/style.py check "$TMP/ref.pdf" --spec "$TMP/pdf.json"
  expect 2 "pdf: a drifted file is caught on face, colour and size" -- \
    python3 house-style/scripts/style.py check "$TMP/drift.pdf" --spec "$TMP/pdf.json"
else
  sk "pdf checks — PyMuPDF not installed (pip install pymupdf)"
fi

if python3 -c "import docx, pptx" 2>/dev/null; then
  PYX=python3
elif [ -x "${VIRTUAL_ENV:-/nonexistent}/bin/python" ] && "${VIRTUAL_ENV}/bin/python" -c "import docx, pptx" 2>/dev/null; then
  PYX="${VIRTUAL_ENV}/bin/python"
else
  PYX=""
fi
if [ -n "$PYX" ]; then
  "$PYX" - "$TMP" <<'PY'
import sys, os, shutil, docx, pptx
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from docx import Document
from docx.shared import Pt as DPt, RGBColor as DRGB
T = sys.argv[1]
# The templates bundled with these libraries are genuine Office output.
shutil.copy(os.path.join(os.path.dirname(docx.__file__), 'templates', 'default.docx'), f'{T}/real.docx')
shutil.copy(os.path.join(os.path.dirname(pptx.__file__), 'templates', 'default.pptx'), f'{T}/real.pptx')
d = Presentation(); d.slide_width, d.slide_height = Inches(13.333), Inches(7.5)
s = d.slides.add_slide(d.slide_layouts[5]); s.shapes.title.text = "Drift"
for para in s.shapes.title.text_frame.paragraphs:
    for r in para.runs:
        r.font.name = "Impact"; r.font.size = Pt(54); r.font.color.rgb = RGBColor(0xD9,0x1C,0x21)
d.save(f'{T}/drift.pptx')
doc = Document(); p = doc.add_paragraph("Drift")
for r in p.runs:
    r.font.name = "Comic Sans MS"; r.font.size = DPt(19); r.font.color.rgb = DRGB(0xD9,0x1C,0x21)
doc.save(f'{T}/drift.docx')
PY
  python3 house-style/scripts/style.py extract "$TMP/real.docx" -o "$TMP/docx.json" >/dev/null 2>&1
  python3 house-style/scripts/style.py extract "$TMP/real.pptx" -o "$TMP/pptx.json" >/dev/null 2>&1
  expect 0 "docx: a real Word file matches its own spec" -- \
    python3 house-style/scripts/style.py check "$TMP/real.docx" --spec "$TMP/docx.json"
  expect 0 "pptx: a real PowerPoint file matches its own spec" -- \
    python3 house-style/scripts/style.py check "$TMP/real.pptx" --spec "$TMP/pptx.json"
  expect 2 "docx: off-house face and off-ladder size are caught" -- \
    python3 house-style/scripts/style.py check "$TMP/drift.docx" --spec "$TMP/docx.json"
  expect 2 "pptx: off-house face, 16:9 geometry and off-ladder size are caught" -- \
    python3 house-style/scripts/style.py check "$TMP/drift.pptx" --spec "$TMP/pptx.json"

  # Voice, not just colour: the same visual system written two different ways.
  "$PYX" - "$TMP" <<'PY2'
import sys
from pptx import Presentation
T = sys.argv[1]
def deck(path, slides):
    p = Presentation()
    for title, bullets in slides:
        s = p.slides.add_slide(p.slide_layouts[1])
        s.shapes.title.text = title
        tf = s.placeholders[1].text_frame; tf.text = bullets[0]
        for b in bullets[1:]: tf.add_paragraph().text = b
    p.save(path)
deck(f'{T}/house.pptx', [
 ("Q3 Revenue", ["Up 12% on Q2", "Enterprise led", "Churn flat"]),
 ("Costs",      ["Headcount steady", "Cloud down 4%", "One-off legal"]),
 ("Pipeline",   ["24 deals open", "Two above 1M", "Close rate 31%"])])
deck(f'{T}/offvoice.pptx', [
 ("We are delighted to report that third quarter revenue grew substantially",
  ["We saw our revenue climb by twelve percent compared with the second quarter, which reflects the hard work of the whole team!",
   "Our enterprise segment led the way once again, and we believe this momentum will continue into the fourth quarter.",
   "We are pleased to note that churn remained flat across the period, which we attribute to our focus on customer success."])])
PY2
  python3 house-style/scripts/style.py extract "$TMP/house.pptx" -o "$TMP/house.json" >/dev/null 2>&1
  expect 0 "prose: the house deck matches its own voice" -- \
    python3 house-style/scripts/style.py check "$TMP/house.pptx" --spec "$TMP/house.json"
  python3 house-style/scripts/style.py check "$TMP/offvoice.pptx" --spec "$TMP/house.json" >"$TMP/out" 2>&1
  for k in density sentences punctuation voice titles; do
    grep -q "\[$k\]" "$TMP/out" || { bad "prose check [$k] did not fire"; sed 's/^/        /' "$TMP/out" | tail -8; break; }
  done
  grep -q '\[density\]' "$TMP/out" && grep -q '\[titles\]' "$TMP/out" \
    && ok "prose: an off-voice deck is caught on density, sentences, punctuation, person and titles" 
else
  sk "docx/pptx checks — python-docx and python-pptx build the fixtures (pip install python-docx python-pptx)"
fi

printf "\n  %d passed, %d failed, %d skipped\n\n" "$pass" "$fail" "$skip"
[ "$fail" -eq 0 ]

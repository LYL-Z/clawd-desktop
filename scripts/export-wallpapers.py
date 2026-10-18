"""Reproducible 4K composition from the approved Clawd runtime assets.

This module crops and composites existing images. It never draws or repairs a
pet, eye, prop, or radial-mark contour. The only vector content is local system
font text and a reference-derived, low-density paper dot field.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, __version__ as pillow_version


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "source" / "wallpapers"
OUTPUT = ROOT / "exports" / "wallpapers"
QA = ROOT / "qa" / "wallpapers"
CELL = (192, 208)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cell(path: Path, row: int, column: int) -> Image.Image:
    with Image.open(path) as image:
        image = image.convert("RGBA")
        x, y = column * CELL[0], row * CELL[1]
        assert x + CELL[0] <= image.width and y + CELL[1] <= image.height
        result = image.crop((x, y, x + CELL[0], y + CELL[1]))
    assert {value for _, value in result.getchannel("A").getcolors()} <= {0, 255}
    assert result.getchannel("A").getbbox(), (path, row, column)
    return result


def placed_origin(placement: dict) -> tuple[int, int]:
    scale = placement["scale"]
    assert isinstance(scale, int) and scale > 0
    if "xy" in placement:
        return tuple(placement["xy"])
    ax, ay = placement["anchor"]
    sx, sy = placement["sourceAnchor"]
    return ax - sx * scale, ay - sy * scale


def number_of_runs(values: list[bool]) -> int:
    return sum(value and (i == 0 or not values[i - 1]) for i, value in enumerate(values))


def theme_asset(asset: Image.Image, placement: dict, background: str) -> Image.Image:
    """Optional contrast-only tint; geometry and binary alpha remain exact."""
    opacity = placement.get("backgroundBlendOpacity", 1.0)
    if opacity == 1.0:
        return asset
    assert placement["asset"] == "mark", "Only the background mark may use contrast adjustment."
    assert 0 < opacity <= 1
    paper = Image.new("RGB", asset.size, background)
    rgb = Image.blend(paper, asset.convert("RGB"), opacity)
    rgb.putalpha(asset.getchannel("A"))
    return rgb


def save_sources(config: dict) -> tuple[dict[str, Image.Image], list[dict]]:
    sources = config["sources"]
    assets = {}
    provenance = []
    for name in ("default", "wizardOverlay"):
        spec = sources[name]
        path = ROOT / spec["path"]
        if "expectedSha256" in spec:
            assert sha256(path) == spec["expectedSha256"], f"Approved source changed: {spec['path']}"
        assets[name] = cell(path, spec["row"], spec["column"])
        provenance.append({"id": name, **spec, "sha256": sha256(path), "operation": "exact 192×208 cell crop"})
    assets["wizard"] = assets["default"].copy()
    assets["wizard"].alpha_composite(assets["wizardOverlay"])
    mark_path = ROOT / sources["mark"]["path"]
    if "expectedSha256" in sources["mark"]:
        assert sha256(mark_path) == sources["mark"]["expectedSha256"], "Approved mark source changed."
    with Image.open(mark_path) as image:
        assets["mark"] = image.convert("RGBA")
    assert {value for _, value in assets["mark"].getchannel("A").getcolors()} <= {0, 255}
    provenance.append({"id": "mark", **sources["mark"], "sha256": sha256(mark_path), "operation": "unchanged image"})
    chorus_path = ROOT / sources["chorus"]["path"]
    if "expectedSha256" in sources["chorus"]:
        assert sha256(chorus_path) == sources["chorus"]["expectedSha256"], "Approved chorus source changed."
    for column in sources["chorus"]["columns"]:
        assets[f"chorus-{column}"] = cell(chorus_path, 0, column)
    provenance.append({"id": "chorus", **sources["chorus"], "sha256": sha256(chorus_path), "operation": "four exact 192×208 cell crops"})
    for name, image in assets.items():
        image.save(SOURCE / f"{name}.png", optimize=False)
    return assets, provenance


def export(config: dict, config_path: Path) -> dict:
    for directory in (SOURCE, OUTPUT, QA):
        directory.mkdir(parents=True, exist_ok=True)
    assert config["canvas"] == [3840, 2160]
    assert config["iconSafeZone"] == [0, 0, 960, 2160]
    font_path = Path(config["font"]["path"])
    assert font_path.is_file(), "Configured local font is unavailable; specify another licensed local font."
    if "expectedSha256" in config["font"]:
        assert sha256(font_path) == config["font"]["expectedSha256"], "Configured font bytes changed."
    font = ImageFont.truetype(str(font_path), config["font"]["size"])
    assets, provenance = save_sources(config)
    default = assets["default"]
    # Identity checks are based on the actual preserved source, not a drawn model.
    four_legs = number_of_runs([default.getpixel((x, 176))[3] == 255 for x in range(default.width)]) == 4
    # The approved project ink is #141413, not mathematically pure RGB black.
    black = [(x, y) for y in range(92, 115) for x in range(35, 157) if default.getpixel((x, y)) == (20, 20, 19, 255)]
    assert four_legs and black, "Approved default source identity check failed."
    eye_columns = sorted({x for x, _ in black})
    two_eyes = number_of_runs([x in eye_columns for x in range(default.width)]) == 2
    assert two_eyes, "Default source must retain two separated black eyes."
    report = {
        "schemaVersion": 1,
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "status": "structural_checks_passed",
        "visualReview": "See qa/wallpapers/visual-review.json. A visual review applies only to the final PNG hashes recorded in that independent file.",
        "software": {"python": platform.python_version(), "pillow": pillow_version},
        "composition": str(config_path.resolve()).replace("\\", "/"),
        "compositionSha256": sha256(config_path),
        "exporterSha256": sha256(Path(__file__)),
        "sources": provenance,
        "font": {"localPath": str(font_path), "sha256": sha256(font_path), "redistributed": False, "note": config["font"]["licenseNote"]},
        "identity": {"defaultFourLegsAtSourceY176": four_legs, "defaultTwoSeparatedBlackEyes": two_eyes},
        "outputs": [],
    }
    preview_images = []
    for theme, palette in config["palettes"].items():
        canvas = Image.new("RGB", tuple(config["canvas"]), palette["background"])
        draw = ImageDraw.Draw(canvas)
        title = config["title"]
        title_box = draw.textbbox(tuple(title["xy"]), title["text"], font=font)
        assert title_box[0] >= 960 and title_box[2] <= canvas.width and title_box[3] <= canvas.height
        draw.text(tuple(title["xy"]), title["text"], font=font, fill=palette["text"], stroke_width=0)
        dots = config["dotField"]
        for row in range(dots["rows"]):
            for col in range(dots["columns"]):
                x = dots["origin"][0] + col * dots["spacing"]
                y = dots["origin"][1] + row * dots["spacing"]
                draw.rectangle((x, y, x + dots["size"] - 1, y + dots["size"] - 1), fill=palette["dots"])
        checks = []
        for placement in config["placements"]:
            asset = theme_asset(assets[placement["asset"]], placement, palette["background"])
            scale = placement["scale"]
            enlarged = asset.resize((asset.width * scale, asset.height * scale), Image.Resampling.NEAREST)
            # Integer expansion must reproduce every input sample exactly.
            reduced = enlarged.resize(asset.size, Image.Resampling.NEAREST)
            assert reduced.tobytes() == asset.tobytes()
            x, y = placed_origin(placement)
            bbox = enlarged.getchannel("A").getbbox()
            visible = [x + bbox[0], y + bbox[1], x + bbox[2], y + bbox[3]]
            assert 960 <= visible[0] < visible[2] <= canvas.width
            assert 0 <= visible[1] < visible[3] <= canvas.height
            canvas.paste(enlarged.convert("RGB"), (x, y), enlarged.getchannel("A"))
            checks.append({"id": placement["id"], "sourceAsset": placement["asset"], "integerScale": scale, "origin": [x, y], "visibleBounds": visible, "fullyInsideCanvas": True, "nearestRoundTripExact": True, "backgroundBlendOpacity": placement.get("backgroundBlendOpacity", 1.0), "sourceAlphaAndContourUnchanged": True})
        # Validate the final pixels rather than merely recording the intended operation.
        for index, (placement, check) in enumerate(zip(config["placements"], checks)):
            asset = theme_asset(assets[placement["asset"]], placement, palette["background"])
            scale = placement["scale"]
            enlarged = asset.resize((asset.width * scale, asset.height * scale), Image.Resampling.NEAREST)
            x, y = placed_origin(placement)
            actual = canvas.crop((x, y, x + enlarged.width, y + enlarged.height))
            expected = enlarged.convert("RGB")
            mask = enlarged.getchannel("A")
            covered = Image.new("L", mask.size, 0)
            for later in config["placements"][index + 1:]:
                later_asset = assets[later["asset"]]
                later_scale = later["scale"]
                later_mask = later_asset.getchannel("A").resize((later_asset.width * later_scale, later_asset.height * later_scale), Image.Resampling.NEAREST)
                lx, ly = placed_origin(later)
                relative = Image.new("L", mask.size, 0)
                relative.paste(later_mask, (lx - x, ly - y))
                covered = ImageChops.lighter(covered, relative)
            visible_mask = ImageChops.subtract(mask, covered)
            original_pixels = mask.histogram()[255]
            visible_pixels = visible_mask.histogram()[255]
            occluded_fraction = 1 - visible_pixels / original_pixels
            if placement.get("allowOcclusion", False):
                assert occluded_fraction <= placement["maxOccludedFraction"], f"Too much of {placement['id']} is hidden."
            else:
                assert occluded_fraction == 0, f"Actor {placement['id']} is occluded."
            # Paper-stage occlusion is explicit. Every visible original sample must survive unchanged.
            diff = ImageChops.difference(actual, expected)
            diff = Image.composite(diff, Image.new("RGB", diff.size, (0, 0, 0)), visible_mask)
            assert diff.getbbox() is None, f"Sprite {placement['id']} was clipped, recoloured or occluded."
            check["finalVisibleOpaquePixelsMatchSourceExactly"] = True
            check["occludedOpaqueFraction"] = occluded_fraction
            check["fullyUnoccluded"] = occluded_fraction == 0
        icon_zone = canvas.crop(tuple(config["iconSafeZone"]))
        assert icon_zone.getcolors(maxcolors=2) == [(960 * 2160, Image.new("RGB", (1, 1), palette["background"]).getpixel((0, 0)))], "Left icon area is not completely clear."
        filename = f"Clawd-{theme}-3840x2160.png"
        target = OUTPUT / filename
        canvas.save(target, format="PNG", compress_level=9, optimize=False)
        with Image.open(target) as decoded:
            assert decoded.size == (3840, 2160)
            assert decoded.convert("RGB").tobytes() == canvas.tobytes()
        preview = canvas.resize((1280, 720), Image.Resampling.NEAREST)
        preview.save(QA / f"preview-{theme}.png")
        preview_images.append(preview)
        report["outputs"].append({"theme": theme, "path": str(target.relative_to(ROOT)).replace("\\", "/"), "sha256": sha256(target), "dimensions": list(canvas.size), "encoding": "lossless opaque RGB PNG", "allCharacterSourceColoursUnchanged": True, "markContrastAdjustment": "The original mark RGB is blended toward the theme paper while retaining its exact contour and binary alpha. No character colour is changed.", "iconSafeZone": config["iconSafeZone"], "iconSafeZoneDensity": 0.0, "titleBounds": list(title_box), "layers": checks})
    pair = Image.new("RGB", (1280, 1440))
    pair.paste(preview_images[0], (0, 0))
    pair.paste(preview_images[1], (0, 720))
    pair.save(QA / "preview-pair.png")
    write_json(QA / "wallpaper-qa.json", report)
    write_json(SOURCE / "source-manifest.json", {"sources": provenance, "font": report["font"], "meaning": "Exact source association. These are generated project assets based on the user-provided Claude references; independent source reproduction permission remains unknown."})
    print(json.dumps({"outputs": [{"path": output["path"], "sha256": output["sha256"]} for output in report["outputs"]], "preview": str(QA / "preview-pair.png"), "checks": "structural checks passed; visual review is recorded separately by final PNG hash"}, ensure_ascii=False, indent=2))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=SOURCE / "composition.json")
    args = parser.parse_args()
    if not args.config.is_file():
        parser.error("Saved composition JSON is required; do not silently fall back to a draft.")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    export(config, args.config)


if __name__ == "__main__":
    main()

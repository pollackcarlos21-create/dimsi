#!/usr/bin/env python3
"""Generate simple, license-free tab icons for the native mini program."""

from pathlib import Path
from PIL import Image, ImageDraw

SIZE = 324
OUT = Path(__file__).resolve().parents[1] / "miniprogram" / "assets" / "tabbar"
INACTIVE = (176, 176, 176, 255)
ACTIVE = (32, 33, 36, 255)
STROKE = 18


def canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def home(color):
    image, draw = canvas()
    draw.line([(54, 138), (162, 48), (270, 138)], fill=color, width=STROKE, joint="curve")
    draw.line([(78, 126), (78, 264), (246, 264), (246, 126)], fill=color, width=STROKE, joint="curve")
    draw.line([(138, 264), (138, 198), (186, 198), (186, 264)], fill=color, width=STROKE, joint="curve")
    return image


def meals(color):
    image, draw = canvas()
    draw.arc([(54, 108), (270, 276)], start=0, end=180, fill=color, width=STROKE)
    draw.line([(44, 120), (280, 120)], fill=color, width=STROKE)
    draw.line([(118, 72), (100, 36)], fill=color, width=STROKE)
    draw.line([(162, 72), (162, 30)], fill=color, width=STROKE)
    draw.line([(206, 72), (224, 36)], fill=color, width=STROKE)
    return image


def chat(color):
    image, draw = canvas()
    draw.rounded_rectangle(
        [(44, 56), (280, 232)],
        radius=46,
        outline=color,
        width=STROKE,
    )
    draw.polygon([(102, 224), (94, 284), (164, 226)], fill=color)
    for x in (112, 162, 212):
        draw.ellipse([(x - 12, 132), (x + 12, 156)], fill=color)
    return image


def settings(color):
    image, draw = canvas()
    for y, knob_x in ((96, 218), (162, 108), (228, 196)):
        draw.line([(48, y), (276, y)], fill=color, width=STROKE)
        draw.ellipse(
            [(knob_x - 28, y - 28), (knob_x + 28, y + 28)],
            fill=(255, 255, 255, 255),
            outline=color,
            width=STROKE,
        )
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, draw_icon in {
        "home": home,
        "meals": meals,
        "chat": chat,
        "settings": settings,
    }.items():
        draw_icon(INACTIVE).resize((81, 81), Image.Resampling.LANCZOS).save(
            OUT / f"{name}.png"
        )
        draw_icon(ACTIVE).resize((81, 81), Image.Resampling.LANCZOS).save(
            OUT / f"{name}-active.png"
        )
    print(f"Generated tab icons in {OUT}")


if __name__ == "__main__":
    main()

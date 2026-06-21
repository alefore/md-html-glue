#!/usr/bin/env python3
import sys
import json
import pathlib
import re
from dataclasses import dataclass, field, asdict
from PIL import Image
from typing import Any, NewType

IMAGES_PREFIX = pathlib.Path("images")
IMAGES_OUT_DIR = pathlib.Path("public/out")

ImageSizeName = NewType("ImageSizeName", str)


@dataclass
class ImageConfigSize:
  width: int
  height: int
  name: ImageSizeName


@dataclass
class ImageConfig:
  name: str
  title: str = ""
  caption: str = ""
  sizes: list[ImageConfigSize] = field(default_factory=list)

  @classmethod
  def load_from_file(cls, img_target: pathlib.Path) -> "ImageConfig":
    """Reads the configuration file and returns an ImageConfig instance."""
    title = ""
    caption = ""
    sizes: list[ImageConfigSize] = []

    with open(
        f"{IMAGES_PREFIX}/{img_target}.public.txt", "r",
        encoding="utf-8") as file:
      for line_num, line in enumerate(file, start=1):
        original_line = line.rstrip("\n")
        line = line.strip()

        if not line:
          continue

        if line.startswith("title "):
          parts = line.split(maxsplit=1)
          if len(parts) < 2:
            raise ValueError(
                f"{line_num}: Missing title text -> '{original_line}'")
          title = parts[1]

        elif line.startswith("size "):
          parts = line.split(maxsplit=2)
          if len(parts) != 3:
            raise ValueError(
                f"{line_num}: Expected 3 parts for size directive -> '{original_line}'"
            )

          size_val, name = parts[1], ImageSizeName(parts[2])

          # Keep validation for the text file format, even though we
          # don't store `size_val` in the final TypeScript-compatible object
          if size_val != "auto":
            try:
              int(size_val)
            except ValueError:
              raise ValueError(
                  f"{line_num}: Size must be an integer or 'auto' -> '{original_line}'"
              )

          new_filename = f"{img_target.stem}_{name}{img_target.suffix}"
          target_image_path = IMAGES_OUT_DIR / IMAGES_PREFIX / new_filename
          if not target_image_path.exists():
            raise FileNotFoundError(
                f"{line_num}: Target image not found at {target_image_path} -> '{original_line}'"
            )

          with Image.open(target_image_path) as img:
            width, height = img.size
          sizes.append(ImageConfigSize(width=width, height=height, name=name))

        elif line.startswith("caption "):
          parts = line.split(maxsplit=1)
          if len(parts) < 2:
            raise ValueError(
                f"{line_num}: Missing caption text -> '{original_line}'")
          caption = parts[1]

        else:
          raise ValueError(
              f"{line_num}: Unrecognized directive -> '{original_line}'")

    sizes.sort(key=lambda s: s.width)
    return cls(name=str(img_target), title=title, sizes=sizes, caption=caption)

  def to_json(self) -> str:
    """Helper to serialize directly to the expected TypeScript interface."""
    return json.dumps(asdict(self), indent=2)


def get_view(path: pathlib.Path, size_name: ImageSizeName) -> str:
  return str(path.with_name(f"{path.stem}_{size_name}{path.suffix}"))


def process_nodes(blocks, gallery_metadata: list[ImageConfig]) -> list[Any]:
  """Walks the AST blocks to extract images inside links, and removes them."""
  updated_blocks = []

  zk_jpg_regex = re.compile("images/[0-9a-z]{3}\\.jpg")
  for block in blocks:
    current_block = block
    if block.get('t') == 'Para' and len(block.get('c', [])) > 0:
      inline = block['c'][0]

      if inline.get('t') == 'Image':
        image_node = inline['c']
        img_target = image_node[2][0]
        print(f"Found image: {img_target}", file=sys.stderr)
        if zk_jpg_regex.match(img_target):
          path = pathlib.Path(img_target)
          image_config = ImageConfig.load_from_file(pathlib.Path(path.name))
          default_image_name = ImageSizeName("thumb")
          thumb_target = get_view(path, default_image_name)
          image_node[2][0] = thumb_target
          loading_attr = "eager" if len(gallery_metadata) < 3 else "lazy"
          image_node[0][2].append(["loading", loading_attr])

          srcset_parts = []
          for size in image_config.sizes:
            src = get_view(path, size.name)
            srcset_parts.append(f"{src} {size.width}w")
          assert srcset_parts
          image_node[0][2].append(["srcset", ", ".join(srcset_parts)])
          image_node[0][2].append(["sizes", "100vw"])
          for size in image_config.sizes:
            if size.name == default_image_name:
              image_node[0][2].append(["width", str(size.width)])
              image_node[0][2].append(["height", str(size.height)])
              break
          gallery_metadata.append(image_config)
          current_block = {
              't':
                  'Div',
              'c': [
                  ["", ["gallery"], []],  # Attributes: id="", class="gallery"
                  [block]
              ]
          }

    if 'c' in block and isinstance(block['c'], list):
      if block['t'] in ['Div', 'BlockQuote']:
        if len(block['c']) == 2 and isinstance(block['c'][1], list):
          block['c'][1] = process_nodes(block['c'][1], gallery_metadata)

    updated_blocks.append(current_block)

  return updated_blocks


def main() -> None:
  doc = json.load(sys.stdin)

  gallery_metadata: list[ImageConfig] = []

  doc['blocks'] = process_nodes(doc['blocks'], gallery_metadata)

  json_payload = json.dumps([asdict(config) for config in gallery_metadata])
  script_tag = f'<script type="application/json" id="gallery-data">{json_payload}</script>'
  raw_html_block = {'t': 'RawBlock', 'c': ['html', script_tag]}
  doc['blocks'].append(raw_html_block)
  json.dump(doc, sys.stdout)


if __name__ == "__main__":
  main()

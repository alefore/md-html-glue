#!/usr/bin/env python3
"""Pandoc filter: expand [](foo.md){template=book-template.md} using the
template file and foo.md's front matter.

Template variables: ${target} is the link URL; every other ${key} is the
value of `key:` in foo.md's YAML front matter (multi-line values allowed).
Paths are relative to the current directory.
"""
import json
import re
import subprocess
import sys

TEMPLATE_LOCATION = "/home/alejo/gallery/src/templates/"


def metadata(path):
  """Front matter as a dict, by a naive line scan (no YAML library)."""
  fm = re.match(r"---\n(.*?)\n(?:---|\.\.\.)\n",
                open(path + ".md").read(), re.S)
  meta = {}
  for m in re.finditer(r"^(\w[\w-]*):[ \t]*(.*)\n((?:[ \t]+\S.*\n)*)",
                       fm.group(1) + "\n" if fm else "", re.M):
    lines = [m.group(2).strip("\"' >|")] + m.group(3).split("\n")
    meta[m.group(1)] = " ".join(l.strip() for l in lines if l.strip())
  return meta


def inlines(md):
  doc = subprocess.run(["pandoc", "-f", "markdown", "-t", "json"],
                       input=md,
                       capture_output=True,
                       text=True,
                       check=True).stdout
  return json.loads(doc)["blocks"][0]["c"]


def expand(template_path, target):
  vars = metadata(target.split("#")[0]) | {"target": target}

  def sub(m):
    if m.group(1) not in vars:
      sys.exit(
          f"{target}: no metadata '{m.group(1)}' (needed by {template_path})")
    return vars[m.group(1)]

  return inlines(
      re.sub(r"\$\{([\w-]+)\}", sub,
             open(TEMPLATE_LOCATION + template_path + ".md").read()))


def walk(node):
  if isinstance(node, dict):
    return {k: walk(v) for k, v in node.items()}
  if not isinstance(node, list):
    return node
  out = []
  for x in node:
    x = walk(x)
    attrs = dict(
        x["c"][0][2]) if isinstance(x, dict) and x["t"] == "Link" else {}
    out += expand(attrs["template"],
                  x["c"][2][0]) if "template" in attrs else [x]
  return out


json.dump(walk(json.load(sys.stdin)), sys.stdout)

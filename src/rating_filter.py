#!/usr/bin/env python3
import json
import sys

MAX = 4


def walk(node):
  if isinstance(node, list):
    return [walk(x) for x in node]
  if not isinstance(node, dict):
    return node
  if node.get("t") == "Span" and "blurb-rating" in node["c"][0][1]:
    (ident, classes, attrs), content = node["c"]
    n = sum(i["c"].count("★") for i in content if i["t"] == "Str")
    if n <= MAX:
      content = [{"t": "Str", "c": "★" * n}]
      if n < MAX:
        content.append({
            "t": "Span",
            "c": [["", ["off"], []], [{
                "t": "Str",
                "c": "★" * (MAX - n)
            }]]
        })
      label = f"Stars: {n} / {MAX}"
      attrs = attrs + [["role", "img"], ["aria-label", label], ["title", label]]
      return {"t": "Span", "c": [[ident, classes, attrs], content]}
  return {k: walk(v) for k, v in node.items()}


doc = json.load(sys.stdin)
doc["blocks"] = walk(doc["blocks"])
json.dump(doc, sys.stdout)

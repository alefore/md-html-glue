function Pandoc(doc)
  local input = PANDOC_STATE.input_files[1]
  assert(input, "hike-filter.lua: no input file (reading from stdin?)")

  -- "3mb.md" -> "3mb"
  local name = input:match("([^/]+)%.md$")
  assert(name, "hike-filter.lua: input file does not end in .md: " .. input)

  local gpx_path = "images/" .. name .. ".gpx"
  local f = assert(io.open(gpx_path, "r"),
    "hike-filter.lua: page has scope 'hike' but track file is missing: " .. gpx_path)
  local gpx = f:read("*a")
  f:close()

  table.insert(doc.blocks, pandoc.RawBlock("html", string.format(
    '<script type="application/gpx+xml" id="hike-data">\n%s</script>', gpx)))
  return doc
end

function Pandoc(doc)
  local track = doc.meta.track
  if not track then return doc end

  local path = pandoc.utils.stringify(track)
  local f = assert(io.open(path, "r"), "track file not found: " .. path)
  local gpx = f:read("*a")
  f:close()

  table.insert(doc.blocks, pandoc.RawBlock("html", string.format(
    '<script type="application/gpx+xml" id="hike-data">\n%s</script>', gpx)))
  table.insert(doc.blocks, pandoc.RawBlock("html",
      '<script src="/hike.js"></script>'))
  return doc
end

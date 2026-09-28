local function image_exists(basename)
  local f = io.open("public/out/images/" .. basename, "r")
  if f ~= nil then
    io.close(f)
    return true
  end
  return false
end

function Image(el)
  if el.src:match("^https?://") then
    return nil  -- Ignore external URLs (http/https)
  end

  -- "images/069.jpg" -> "069.jpg"
  local basename = el.src:match("([^/]+)$") or el.src

  local target_file = nil
  if image_exists(basename) then
    target_file = basename
  else
    return nil  -- leave the image tag untouched
  end

  local cmd = string.format('anytopnm "public/out/images/%s" 2>/dev/null | pnmfile', target_file)
  io.stderr:write(string.format("[DEBUG] Image filter: %s", cmd))
  local handle = io.popen(cmd)
  local result = handle:read("*a")
  handle:close()

  local w, h = result:match("(%d+)%s+by%s+(%d+)")

  if w and h then
    el.attributes['width'] = w
    el.attributes['height'] = h
    el.src = "images/" .. target_file
    return el
  end
end

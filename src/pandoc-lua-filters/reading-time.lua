function Pandoc(doc)
  local reading_time_val = nil
  if doc.meta.reading_time then
    reading_time_val = pandoc.utils.stringify(doc.meta.reading_time)
  end

  if reading_time_val and reading_time_val ~= "" then
    local li_html = '<li id="reading_time">' .. reading_time_val .. '</li>'
    local h1_idx, ul_idx = nil, nil

    -- 1. Scan for the first H1 and an existing metadata UL
    for i, b in ipairs(doc.blocks) do
      if not h1_idx and b.t == "Header" and b.level == 1 then
        h1_idx = i
      end
      -- Check if it's an HTML block containing our specific <ul>
      if b.t == "RawBlock" and b.format:match("html") and b.text:match("<ul[^>]*id%s*=%s*[\"']?metadata[\"']?") then
        ul_idx = i
        break -- Found the UL, no need to keep scanning
      end
    end

    -- 2. Inject or Create
    if ul_idx then
      -- Inject the <li> right before the closing </ul> tag
      local text = doc.blocks[ul_idx].text
      doc.blocks[ul_idx].text = text:gsub("(</ul%s*>)", li_html .. "%1", 1)
    elseif h1_idx then
      -- No existing UL found: Create a new one right after the first H1
      local ul_html = '<ul id="metadata">' .. li_html .. '</ul>'
      doc.blocks:insert(h1_idx + 1, pandoc.RawBlock("html", ul_html))
    end
  end

  return doc
end

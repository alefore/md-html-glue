local found_first_h2 = false

function Header(el)
  -- Check if the header is an H2 and we haven't found one yet
  if el.level == 2 and not found_first_h2 then
    -- Add the specific class to this element
    table.insert(el.classes, "first-page-heading")

    -- Flag that we found it so subsequent H2s are ignored
    found_first_h2 = true

    -- Return the modified element
    return el
  end
end

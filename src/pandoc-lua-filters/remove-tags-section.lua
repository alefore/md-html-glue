-- A value of 0 means we're not removing.
-- A value > 0 means we're removing content under a heading of that level.
local remove_level = 0

function Header(el)
  if el.level <= remove_level then
    remove_level = 0
  end
  if remove_level == 0 then
    if (pandoc.utils.stringify(el):match("^Tags$") and el.level == 2) or
        pandoc.utils.stringify(el):match("^Private$") then
      remove_level = el.level
    end
  end
  if remove_level > 0 then
    return {}
  end
  return nil
end

function Block(el)
  if remove_level > 0 then
    return {}
  end
  return nil
end

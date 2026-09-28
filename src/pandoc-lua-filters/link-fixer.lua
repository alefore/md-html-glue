function Link (link)
  link.target = string.gsub(link.target, '%.md(#?.*)$', '%1')
  return link
end

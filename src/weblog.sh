#!/usr/bin/bash

. ~/bin/debug.sh
. ~/bin/concurrency-tokens.sh
. ~/bin/caploop.sh

set -e

mkdir -p public/{static/images,out}
cp ~/gallery/dist/swipe.js ~/gallery/src/gallery.css ~/gallery/dist/gallery.js public/static
for image in $(cat images/public.txt)
do
  echo "Publish image: $image"
  cp images/$image public/static/images/$image
done

function process_markdown_file {
  local file=$1
  echo "Processing: $file"
  extra_css_args=""
  extra_js_tags=""
  POST_DATE=""
  local reading_time=""
  extra_filters=""
  for scope in $(grep '^Scope:' "$file" | sed 's/^Scope: *//'); do
    if [[ -f "public/static/${scope}.css" ]]; then
      echo "  -> Found CSS for scope: ${scope}"
      extra_css_args+=" --css=${scope}.css"
    fi
    if [[ -f "public/static/${scope}.js" ]]; then
      echo "  -> Found JS for scope: ${scope}"
      extra_js_tags+="<script type=module src=\"${scope}.js\"></script>"
    fi
    if [[ ${scope} = "post" ]]; then
      POST_DATE=$(~/bin/show-post-date $file)
      echo "  -> Found post, date: $POST_DATE"
      words=$(sed -E 's/\[([^]]*)\]\([^)]*\)/\1/g; s|https?://[^ ]*||g' "$1" | wc -w)
      mins=$(( (words + 199) / 200 ))
      [ "$mins" -lt 1 ] && mins=1
      reading_time="$mins min"
    fi
    if [[ ${scope} = "gallery" ]]; then
      extra_filters="--filter=public/src/gallery-filter.py"
    fi

    lua_filter_path="public/src/${scope}-filter.lua"
    if [[ -f "${lua_filter_path}" ]]; then
      if [[ -n "${extra_filters}" ]]; then
        extra_filters+=" --lua-filter=${lua_filter_path}"
      else
        extra_filters="--lua-filter=${lua_filter_path}"
      fi
    fi
  done

  title=$(head -1 $file | sed 's/^#* *//')
  pandoc -s -f markdown \
    --template=public/src/template.html \
    --metadata title="$title" \
    --metadata post_date="$POST_DATE" \
    --metadata reading_time="$reading_time" \
    --css=style-base.css --css=style.css $extra_css_args \
    --lua-filter=public/src/link-fixer.lua \
    --lua-filter=public/src/remove-tags-section.lua \
    --lua-filter=public/src/post-date.lua \
    --lua-filter=public/src/reading-time.lua \
    --lua-filter=public/src/image-filter.lua \
    --lua-filter=public/src/first-h2-filter.lua \
    $extra_filters \
    -B <(echo '<main>') \
    -A <(echo "</main><script src='https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js'></script>${extra_js_tags}") \
    "$file" -o "public/out/${file%.md}.html"
}

function process_image_file {
  local config="$1"
  local source="${config%.public.txt}"
  local base="${source##*/}"
  echo "Processing image: $source ($config)"
  while read -r line; do
    [[ -z "$line" ]] && continue  # Skip empty lines.
    case "$line" in
      "size "*)
        read -r size size_name <<< "${line#size }"
        local base_name="${base%.*}"
        local base_ext="${base##*.}"
        local target="public/out/images/${base_name}_${size_name}.${base_ext}"
        if [[ "$size" == "auto" ]]; then
          cp "$source" "$target"
          continue
        fi

        # Netpbm handles the portrait/landscape math automatically.
        jpegtopnm -quiet "$source" | pnmscale -xysize "$size" "$size" |
        pnmtojpeg > "$target"
        ;;

      "title"*)
        continue  # Ignore it.
        ;;

      "caption"*)
        continue  # Ignore it.
        ;;

      *)
        echo "Unrecognized configuration line in $config: '$line'" >&2
        exit 1
        ;;
    esac
  done < "$config"
}

ls images/*.public.txt | caploop process_image_file
grep -l '^Visibility: public$' ???.md | caploop process_markdown_file
mv public/out/3kp.html public/out/index.html

cp -R public/static/. public/out
if [ -z "$WEBLOG_ONLY_ZIP" ] && command -v wrangler >/dev/null 2>&1; then
  wrangler pages deploy public/out --project-name text --branch main
else
  zip -j public/out.zip public/out/*
fi

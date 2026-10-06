#!/usr/bin/env bash
set -euo pipefail
# Requires ffmpeg with libvpx/WebP. Pass the supplied source WebM as argument.
# Trim the black tail and blend only original frames into the loop seam.
source_video=${1:?Pass the supplied source WebM}
asset_dir="$(cd "$(dirname "$0")/.." && pwd)/public/brand/wallpapers"
ffmpeg -y -i "$source_video" -filter_complex '[0:v]scale=1920:1080:flags=lanczos,split=3[m][t][h];[m]trim=start=0.6:end=14.3,setpts=PTS-STARTPTS[mc];[t]trim=start=14.3:end=14.9,setpts=PTS-STARTPTS[tc];[h]trim=start=0:end=0.6,setpts=PTS-STARTPTS[hc];[tc][hc]blend=all_expr=A*(1-T/0.6)+B*T/0.6:shortest=1[seam];[mc][seam]concat=n=2:v=1:a=0[out]' -map '[out]' -an -c:v libvpx-vp9 -crf 35 -b:v 0 -row-mt 1 -threads 3 -cpu-used 4 "$asset_dir/synnical-default-wallpaper.webm"
ffmpeg -y -ss 0.6 -i "$source_video" -frames:v 1 -vf scale=1920:1080:flags=lanczos -quality 92 "$asset_dir/synnical-default-wallpaper-poster.webp"

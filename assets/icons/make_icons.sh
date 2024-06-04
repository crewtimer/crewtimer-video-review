#for size in 16 24 32 48 64 96 128 256 512 1024
#do
#  sips -Z $size crewtimer-1024.png --out ${size}x${size}.png
#done

# brew install --cask inkscape

set -e
if [ ! -f "$1" ]; then
  echo "Usage: $0 <logo.svg>"
fi

LOGO="$1"
for size in 16 24 32 48 64 96 128 256 512 1024
do
   inkscape ${LOGO} --export-filename=${size}x${size}.png --export-width=${size} --export-height=${size}
done
cp 256x256.png ../icon.png

# "see https://www.aconvert.com/image/png-to-icns/#google_vignette to build icns file or ask chatgpt how using mac command line"

mkdir -p icons.iconset
cp 16x16.png icons.iconset/icon_16x16.png
cp 32x32.png icons.iconset/icon_16x16@2x.png
cp 32x32.png icons.iconset/icon_32x32.png
cp 64x64.png icons.iconset/icon_32x32@2x.png
cp 128x128.png icons.iconset/icon_128x128.png
cp 256x256.png icons.iconset/icon_128x128@2x.png
cp 256x256.png icons.iconset/icon_256x256.png
cp 512x512.png icons.iconset/icon_256x256@2x.png
cp 512x512.png icons.iconset/icon_512x512.png
cp 1024x1024.png icons.iconset/icon_512x512@2x.png
iconutil -c icns icons.iconset -o ../icon.icns
convert 16x16.png 32x32.png 48x48.png 64x64.png 128x128.png 256x256.png ../icon.ico
rm -rf icons.iconset
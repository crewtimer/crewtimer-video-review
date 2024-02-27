{
  "targets": [
    {
      "target_name": "crewtimer_video_reader",
      "sources": [ "src/FFReaderAPI.cpp", "src/FFReader.cpp" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "conditions": [
        ['OS=="mac"', {
          "include_dirs": [
              "./src/ffmpeg-built-mac/include",
            ],
          "link_settings": {
            "libraries": [
                "./src/ffmpeg-built-mac/lib/libavcodec.a",
                "./src/ffmpeg-built-mac/lib/libavdevice.a",
                "./src/ffmpeg-built-mac/lib/libavfilter.a",
                "./src/ffmpeg-built-mac/lib/libavformat.a",
                "./src/ffmpeg-built-mac/lib/libavutil.a",
                "../src/ffmpeg-built-mac/lib/libswresample.a",
                "../src/ffmpeg-built-mac/lib/libswscale.a"],

            'library_dirs': ['../src/ffmpeg-built-mac/lib']
          }
      }],

      ['OS=="win"', {
        "include_dirs": [
          "./src/ffmpeg-built-win/include",
        ],
        "link_settings": {
            "libraries": [
                "../src/ffmpeg-built-win/lib/libavcodec.a",
                "../src/ffmpeg-built-win/lib/libavformat.a",
                "../src/ffmpeg-built-win/lib/libavutil.a",
                "../src/ffmpeg-built-win/lib/libswscale.a",
                "Bcrypt.lib", "Mfuuid.lib", "Strmiids.lib"
            ],
          'library_dirs': ['../src/ffmpeg-built-win/lib']
          }
        }],
      ],

      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS",
                  "NAPI_VERSION=<(napi_build_version)", ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ]
    }
  ]
}

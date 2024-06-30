{
  "targets": [
    {
      "target_name": "crewtimer_video_reader",
      "sources": [ "src/FFReaderAPI.cpp", "src/FFReader.cpp", "src/sendMulticast.cpp", "src/FrameUtils.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "conditions": [
        ['OS=="mac"', {
           "cflags": [ "-frtti"],
          "cflags_cc!": [ "-frtti" ],
          "xcode_settings": {
            "OTHER_CFLAGS": [
              "-frtti"
            ],
            "OTHER_CPLUSPLUSFLAGS": [
              "-frtti"
            ],
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY" : "libc++"

          },
          "include_dirs": [
              "./src/ffmpeg-built-mac/include",
              "/usr/local/Cellar/opencv/4.9.0_7/include/opencv4"
            ],
          "link_settings": {
            "libraries": [
                "../src/ffmpeg-built-mac/lib/libavcodec.a",
                "../src/ffmpeg-built-mac/lib/libavdevice.a",
                "../src/ffmpeg-built-mac/lib/libavfilter.a",
                "../src/ffmpeg-built-mac/lib/libavformat.a",
                "../src/ffmpeg-built-mac/lib/libavutil.a",
                "../src/ffmpeg-built-mac/lib/libswresample.a",
                "../src/ffmpeg-built-mac/lib/libswscale.a",
                 "-lopencv_core",
        "-lopencv_imgproc",
        "-lopencv_video"],

            'library_dirs': ['../src/ffmpeg-built-mac/lib']
          }
      }],

      ['OS=="win"', {
        "include_dirs": [
          "y:/ffmpeg-built-win/include",
          "C:/OpenCV/opencv/build/include"
        ],
        "link_settings": {
            "libraries": [
                "y:/ffmpeg-built-win/lib/libavcodec.a",
                "y:/ffmpeg-built-win/lib/libavformat.a",
                "y:/ffmpeg-built-win/lib/libavutil.a",
                "y:/ffmpeg-built-win/lib/libswscale.a",
                "y:/ffmpeg-built-win/lib/libswresample.a",
                "C:/OpenCV/opencv/build/x64/vc16/lib/opencv_world490.lib",
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

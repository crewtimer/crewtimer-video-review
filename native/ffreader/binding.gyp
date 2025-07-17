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
              "./lib-build/ffmpeg-static-mac/include",
              "./lib-build/opencv-static-mac/include/opencv4",
            ],
          "link_settings": {
            "libraries": [
                "../lib-build/ffmpeg-static-mac/lib/libavcodec.a",
                "../lib-build/ffmpeg-static-mac/lib/libavformat.a",
                "../lib-build/ffmpeg-static-mac/lib/libavutil.a",
                "../lib-build/ffmpeg-static-mac/lib/libswscale.a",
                "../lib-build/opencv-static-mac/lib/libopencv_core.a",
                "../lib-build/opencv-static-mac/lib/libopencv_imgproc.a",
                "../lib-build/opencv-static-mac/lib/libopencv_video.a"],

            'library_dirs': ['../lib-build/ffmpeg-static-mac/lib']
          }
      }],

      ['OS=="win"', {
        "include_dirs": [
          "./lib-build/ffmpeg-static-win/include",
          "./lib-build/opencv-static-win/include"
        ],
        "link_settings": {
            "libraries": [
                "../lib-build/ffmpeg-static-win/lib/libavcodec.a",
                "../lib-build/ffmpeg-static-win/lib/libavformat.a",
                "../lib-build/ffmpeg-static-win/lib/libavutil.a",
                "../lib-build/ffmpeg-static-win/lib/libswscale.a",
                "../lib-build/opencv-static-win/staticlib/opencv_core490.lib",
                "../lib-build/opencv-static-win/staticlib/opencv_imgproc490.lib",
                "../lib-build/opencv-static-win/staticlib/opencv_video490.lib",
                "../lib-build/vcpkg/installed/x64-windows-static/lib/zlib.lib",
                "Bcrypt.lib", "Mfuuid.lib", "Strmiids.lib"
            ],
          'library_dirs': ["../lib-build/ffmpeg-static-win/lib",
                           "../lib-build/opencv-static-win/staticlib"]
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

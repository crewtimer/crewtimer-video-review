{
  "targets": [
    {
      "target_name": "crewtimer_video_reader",
      "sources": [ "src/FFReaderAPI.cpp", "src/FFReader.cpp", "src/sendMulticast.cpp", "src/FrameUtils.cpp", "src/BowCardDetector.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "conditions": [
        ['OS=="mac"', {
          "sources": ["src/MacOSLocalNetworkPermission.mm", "src/RifeInterpolator.cpp"],
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
            "CLANG_CXX_LIBRARY": "libc++",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "OTHER_LDFLAGS": ["-Wl,-rpath,@loader_path"]
          },
          "include_dirs": [
              "./lib-build/ffmpeg-static-mac/include",
              "./lib-build/opencv-static-mac/include/opencv5",
              "./lib-build/onnxruntime-static-mac/include",
            ],
          "defines": [ "RIFE_SUPPORTED" ],
          "link_settings": {
            "libraries": [
                "../lib-build/ffmpeg-static-mac/lib/libavcodec.a",
                "../lib-build/ffmpeg-static-mac/lib/libavformat.a",
                "../lib-build/ffmpeg-static-mac/lib/libavutil.a",
                "../lib-build/ffmpeg-static-mac/lib/libswscale.a",
                "../lib-build/opencv-static-mac/lib/libopencv_dnn.a",
                "../lib-build/opencv-static-mac/lib/libopencv_video.a",
                "../lib-build/opencv-static-mac/lib/libopencv_imgproc.a",
                "../lib-build/opencv-static-mac/lib/libopencv_geometry.a",
                "../lib-build/opencv-static-mac/lib/libopencv_flann.a",
                "../lib-build/opencv-static-mac/lib/libopencv_core.a",
                "../lib-build/opencv-static-mac/lib/opencv5/3rdparty/libtegra_hal.a",
                "../lib-build/opencv-static-mac/lib/opencv5/3rdparty/libkleidicv_hal.a",
                "../lib-build/opencv-static-mac/lib/opencv5/3rdparty/libkleidicv.a",
                "../lib-build/opencv-static-mac/lib/opencv5/3rdparty/libkleidicv_thread.a",
                "../lib-build/opencv-static-mac/lib/opencv5/3rdparty/libzlib.a",
                "../lib-build/opencv-static-mac/lib/opencv5/3rdparty/liblibprotobuf.a",
                "../lib-build/onnxruntime-static-mac/lib/libonnxruntime.1.dylib",
                "-framework VideoToolbox",
                "-framework CoreVideo",
                "-framework CoreMedia",
                "-framework CoreFoundation",
                "-framework OpenCL",
                "-framework Accelerate",
                "-framework Foundation",
                "-framework Network"],

            'library_dirs': ['../lib-build/ffmpeg-static-mac/lib']
          },
          "copies": [
            {
              "destination": "<(PRODUCT_DIR)",
              "files": [ "lib-build/onnxruntime-static-mac/lib/libonnxruntime.1.dylib" ]
            }
          ]
      }],

      ['OS=="win"', {
        "sources": ["src/RifeInterpolator.cpp"],
        "msvs_settings": {
          "VCCLCompilerTool": {
            "AdditionalOptions": ["/std:c++17"]
          }
        },
        "include_dirs": [
          "./lib-build/ffmpeg-static-win/include",
          "./lib-build/opencv-static-win/include",
          "./lib-build/onnxruntime-static-win/include"
        ],
        "defines": [ "RIFE_SUPPORTED" ],
        "link_settings": {
            "libraries": [
                "../lib-build/ffmpeg-static-win/lib/libavcodec.a",
                "../lib-build/ffmpeg-static-win/lib/libavformat.a",
                "../lib-build/ffmpeg-static-win/lib/libavutil.a",
                "../lib-build/ffmpeg-static-win/lib/libswscale.a",
                "../lib-build/opencv-static-win/staticlib/opencv_dnn500.lib",
                "../lib-build/opencv-static-win/staticlib/opencv_video500.lib",
                "../lib-build/opencv-static-win/staticlib/opencv_imgproc500.lib",
                "../lib-build/opencv-static-win/staticlib/opencv_geometry500.lib",
                "../lib-build/opencv-static-win/staticlib/opencv_flann500.lib",
                "../lib-build/opencv-static-win/staticlib/opencv_core500.lib",
                "../lib-build/opencv-static-win/staticlib/libprotobuf.lib",
                "../lib-build/vcpkg/installed/x64-windows-static/lib/zlib.lib",
                "../lib-build/onnxruntime-static-win/lib/onnxruntime.lib",
                "Bcrypt.lib", "Mfuuid.lib", "Strmiids.lib",
                "d3d11.lib", "dxgi.lib"
            ],
          'library_dirs': ["../lib-build/ffmpeg-static-win/lib",
                           "../lib-build/opencv-static-win/staticlib"]
          },
        "copies": [
          {
            "destination": "<(PRODUCT_DIR)",
            "files": [
              "lib-build/onnxruntime-static-win/lib/onnxruntime.dll",
              "lib-build/onnxruntime-static-win/lib/onnxruntime_providers_shared.dll"
            ]
          }
        ]
        }],
      ],

      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS",
                  "NAPI_VERSION=<(napi_build_version)", ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ]
    }
  ]
}

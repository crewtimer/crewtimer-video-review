cmake_minimum_required(VERSION 3.10)
project(yolov8_detect)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find OpenCV
find_package(OpenCV REQUIRED)

# Add source files
set(SOURCES
    main.cpp
)

set(HEADERS
    YOLOv8Detector.hpp
)

add_executable(yolov8_detect ${SOURCES} ${HEADERS})

target_include_directories(yolov8_detect PRIVATE ${OpenCV_INCLUDE_DIRS})

target_link_libraries(yolov8_detect PRIVATE ${OpenCV_LIBS})

# Optionally, show OpenCV info
message(STATUS "OpenCV libraries: ${OpenCV_LIBS}")
message(STATUS "OpenCV include dirs: ${OpenCV_INCLUDE_DIRS}")
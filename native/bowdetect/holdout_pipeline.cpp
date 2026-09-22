// Small streaming adapter around the exact pipeline linked by the review app.
// Input: ASCII width/height line followed by width*height*3 BGR bytes.
// Output: one JSON array per image. Diagnostics go to stderr.
#include "BowNumberPipeline.hpp"
#include <iostream>
#include <stdexcept>

static void box(const cv::Rect &r) {
  std::cout << '[' << r.x << ',' << r.y << ',' << r.x + r.width << ','
            << r.y + r.height << ']';
}

int main(int argc, char **argv) {
  try {
    if (argc != 4) throw std::runtime_error("Expected boat, card and number model paths");
    BowNumberPipeline pipeline(argv[1], argv[2], argv[3]);
    int width, height;
    while (std::cin >> width >> height) {
      if (std::cin.get() != '\n' || width <= 0 || height <= 0 ||
          width > 32768 || height > 32768)
        throw std::runtime_error("Invalid image dimensions/header");
      cv::Mat frame(height, width, CV_8UC3);
      if (!std::cin.read(reinterpret_cast<char *>(frame.data), frame.total() * 3))
        throw std::runtime_error("Incomplete image data");
      const auto detections = pipeline.detectAll(frame);
      std::cout << '[';
      bool first = true;
      for (const auto &d : detections) {
        if (!first) std::cout << ',';
        first = false;
        std::cout << "{\"boat\":"; box(d.boatBox);
        std::cout << ",\"card\":"; box(d.cardBox);
        // Decoder vocabulary contains only ASCII digits and uppercase letters.
        std::cout << ",\"text\":\"" << d.text << "\",\"confidence\":"
                  << d.confidence << '}';
      }
      std::cout << "]" << std::endl;
    }
    return 0;
  } catch (const std::exception &error) {
    std::cerr << error.what() << std::endl;
    return 1;
  }
}

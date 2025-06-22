#include "YOLOv8Detector.hpp"
#include <opencv2/opencv.hpp>
#include <iostream>
#include <vector>
#include <string>

// COCO class names for annotation
const std::vector<std::string> coco_class_names = {
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "boat", "boat", "traffic light",
    "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
    "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
    "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
    "hair drier", "toothbrush"
};

void print_usage(const char* progname) {
    std::cout << "Usage: " << progname << " -f <video_filename> [-m <model_file>] [-s <skip_frames>] [-d]\n";
    std::cout << "  -f <video_filename>   Path to video file\n";
    std::cout << "  -m <model_file>       Path to ONNX model file (default: ../test/yolov8s.onnx)\n";
    std::cout << "  -s <skip_frames>      Number of frames to skip before processing (default: 0)\n";
    std::cout << "  -d                    Enable debug output\n";
}

int main(int argc, char* argv[]) {
    std::string video_path;
    std::string model_path = "../test/yolov8s.onnx";
    int skip_frames = 0;
    bool debug = false;

    // Simple argument parsing
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if ((arg == "-f" || arg == "--file") && i + 1 < argc) {
            video_path = argv[++i];
        } else if ((arg == "-m" || arg == "--model") && i + 1 < argc) {
            model_path = argv[++i];
        } else if ((arg == "-s" || arg == "--skip") && i + 1 < argc) {
            skip_frames = std::stoi(argv[++i]);
        } else if (arg == "-d" || arg == "--debug") {
            debug = true;
        } else if (arg == "-h" || arg == "--help") {
            print_usage(argv[0]);
            return 0;
        } else {
            std::cerr << "Unknown argument: " << arg << "\n";
            print_usage(argv[0]);
            return 1;
        }
    }

    if (video_path.empty()) {
        std::cerr << "[ERROR] Video filename must be specified with -f\n";
        print_usage(argv[0]);
        return 1;
    }

    cv::VideoCapture cap(video_path);
    if (!cap.isOpened()) {
        std::cerr << "[ERROR] Could not open video file: " << video_path << std::endl;
        return -1;
    }

    // Skip frames if requested
    for (int i = 0; i < skip_frames; ++i) {
        cv::Mat tmp;
        if (!cap.read(tmp)) {
            std::cerr << "[ERROR] Could not skip frame " << i << " (end of video?)\n";
            return -1;
        }
    }

    YOLOv8Detector detector(model_path, 0.1f, 0.45f, 640, debug);

    int frame_idx = skip_frames;
    cv::Mat frame;
    Detection prev_boat_detection;
    bool prev_boat_found = false;

    while (cap.read(frame)) {
        std::vector<Detection> detections = detector.detect(frame);

        // Draw all detections
        for (const auto& det : detections) {
            cv::rectangle(frame, det.box, cv::Scalar(0, 255, 0), 2);
            std::string label;
            if (det.class_id >= 0 && det.class_id < coco_class_names.size()) {
                label = coco_class_names[det.class_id];
            } else {
                label = "unknown";
            }
            label += " " + cv::format("%.2f", det.confidence);
            if (debug) {
                std::cout << "[DETECT] " << label << " " << det.box << std::endl;
            }
            cv::putText(frame, label, det.box.tl(), cv::FONT_HERSHEY_SIMPLEX, 0.7, cv::Scalar(255, 0, 0), 1);
        }

        // Find largest detection for class id 8 ("boat")
        Detection largest_boat;
        bool boat_found = detector.getLargestDetectionForClass(detections, 8, largest_boat);

        if (boat_found) {
            // Draw a red rectangle for the largest boat
            cv::rectangle(frame, largest_boat.box, cv::Scalar(0, 0, 255), 2);
            std::string boat_label = "boat " + cv::format("%.2f", largest_boat.confidence);
            cv::putText(frame, boat_label, largest_boat.box.tl(), cv::FONT_HERSHEY_SIMPLEX, 1.0, cv::Scalar(0, 0, 255), 2);

            if (prev_boat_found) {
                // Compute and print delta between previous and current largest boat
                YOLOv8Detector::DetectionDelta delta = YOLOv8Detector::getDetectionDelta(prev_boat_detection, largest_boat);
                std::cout << "[boat DELTA] Frame " << frame_idx
                          << ": Left dx=" << delta.delta_left_x << ", dy=" << delta.delta_left_y
                          << " | Right dx=" << delta.delta_right_x << ", dy=" << delta.delta_right_y << std::endl;
            }
            prev_boat_detection = largest_boat;
            prev_boat_found = true;
        } else {
            prev_boat_found = false;
        }

        // Annotate frame number in upper left corner
        std::string frame_label = "Frame: " + std::to_string(frame_idx);
        cv::putText(frame, frame_label, cv::Point(10, 30), cv::FONT_HERSHEY_SIMPLEX, 1.0, cv::Scalar(0,255,255), 2);

        cv::imshow("YOLOv8 Detections", frame);
        // std::cout << "[INFO] Frame " << frame_idx << std::endl;
        int key = cv::waitKey(0);
        if (key == 27) { // ESC
            break;
        }
        ++frame_idx;
    }

    cap.release();
    cv::destroyAllWindows();
    return 0;
}
#include <opencv2/opencv.hpp>
#include <opencv2/dnn.hpp>
#include <iostream>
#include <filesystem>
#include <string>
#include <vector>
#include <algorithm>
#include <getopt.h>

namespace fs = std::filesystem;

// Helper for argument parsing
struct Args
{
  std::string video;
  int start = 0;
  int count = -1;
  std::string save_dir;
  bool step = false;
  std::string side = "left";
};

void print_usage(const char *prog)
{
  std::cout << "Usage: " << prog << " <video> [--start N] [--count N] [--save_dir DIR] [--step] [--side left|right]\n";
}

bool parse_args(int argc, char **argv, Args &args)
{
  static struct option long_options[] = {
      {"start", required_argument, 0, 's'},
      {"count", required_argument, 0, 'n'},
      {"save_dir", required_argument, 0, 'd'},
      {"step", no_argument, 0, 'p'},
      {"side", required_argument, 0, 'i'},
      {0, 0, 0, 0}};
  int opt;
  int option_index = 0;
  while ((opt = getopt_long(argc, argv, "s:n:d:pi:", long_options, &option_index)) != -1)
  {
    switch (opt)
    {
    case 's':
      args.start = std::stoi(optarg);
      break;
    case 'n':
      args.count = std::stoi(optarg);
      break;
    case 'd':
      args.save_dir = optarg;
      break;
    case 'p':
      args.step = true;
      break;
    case 'i':
      args.side = optarg;
      break;
    default:
      print_usage(argv[0]);
      return false;
    }
  }
  if (optind < argc)
  {
    args.video = argv[optind];
  }
  else
  {
    print_usage(argv[0]);
    return false;
  }
  if (args.side != "left" && args.side != "right")
  {
    std::cerr << "ERROR: --side must be 'left' or 'right'\n";
    return false;
  }
  return true;
}

// Letterbox resize for YOLOv8
cv::Mat letterbox(const cv::Mat &src, int new_shape = 640, cv::Scalar color = {114, 114, 114},
                  bool auto_ = true, bool scaleFill = false, bool scaleUp = true, cv::Mat *outPad = nullptr, float *scale = nullptr)
{
  int width = src.cols, height = src.rows;
  float r = std::min((float)new_shape / height, (float)new_shape / width);
  if (!scaleUp)
    r = std::min(r, 1.0f);
  int new_unpad_w = int(round(width * r));
  int new_unpad_h = int(round(height * r));
  cv::Mat resized;
  cv::resize(src, resized, cv::Size(new_unpad_w, new_unpad_h));
  int dw = new_shape - new_unpad_w;
  int dh = new_shape - new_unpad_h;
  dw /= 2;
  dh /= 2;
  cv::Mat out;
  cv::copyMakeBorder(resized, out, dh, new_shape - new_unpad_h - dh, dw, new_shape - new_unpad_w - dw, cv::BORDER_CONSTANT, color);
  if (outPad)
    *outPad = (cv::Mat_<float>(1, 4) << dw, dh, r, r);
  if (scale)
    *scale = r;
  return out;
}

// Structure for detection
struct Detection
{
  int class_id;
  float conf;
  cv::Rect box;
};

// Parse YOLOv8 ONNX output in [1, 84, 8400] format (no transpose)
std::vector<Detection> parse_yolov8(const cv::Mat &output, float confThreshold, float iouThreshold, int num_classes, int orig_w, int orig_h, float scale, int pad_w, int pad_h)
{
  std::vector<Detection> detections;
  // output: [1, 84, 8400] (batch, features, num_boxes)
  if (output.dims != 3 || output.size[0] != 1)
  {
    std::cerr << "Unexpected output shape: dims=" << output.dims << " sizes=";
    for (int i = 0; i < output.dims; ++i)
      std::cerr << output.size[i] << " ";
    std::cerr << std::endl;
    return detections;
  }
  int num_features = output.size[1];
  int num_boxes = output.size[2];
  if (num_features != 84)
  {
    std::cerr << "Unexpected number of features: " << num_features << " (expected 84)" << std::endl;
    return detections;
  }
  for (int i = 0; i < num_boxes; ++i)
  {
    float cx = output.at<float>(0, 0, i);
    float cy = output.at<float>(0, 1, i);
    float w = output.at<float>(0, 2, i);
    float h = output.at<float>(0, 3, i);
    // class scores: output.at<float>(0, 4 + c, i) for c in [0, num_classes)
    float max_class_conf = -1.0f;
    int class_id = -1;
    for (int c = 0; c < num_classes; ++c)
    {
      float score = output.at<float>(0, 4 + c, i);
      if (score > max_class_conf)
      {
        max_class_conf = score;
        class_id = c;
      }
    }
    float conf = max_class_conf;
    if (conf < confThreshold)
      continue;
    // Undo letterbox
    float x = (cx - 0.5f * w - pad_w) / scale;
    float y = (cy - 0.5f * h - pad_h) / scale;
    float ww = w / scale;
    float hh = h / scale;
    cv::Point pt((int(x)), (int(y)));
    cv::Size sz((int(ww)), (int(hh)));
    const cv::Rect rect(pt, sz);
    detections.push_back({class_id, conf, rect});
  }
  // NMS
  std::vector<int> indices;
  std::vector<cv::Rect> boxes;
  std::vector<float> scores;
  for (const auto &d : detections)
  {
    boxes.push_back(d.box);
    scores.push_back(d.conf);
  }
  cv::dnn::NMSBoxes(boxes, scores, confThreshold, iouThreshold, indices);
  std::vector<Detection> result;
  for (int idx : indices)
    result.push_back(detections[idx]);
  return result;
}

// Find best boat point
bool best_boat_point(const std::vector<Detection> &dets, const std::string &side, int &x1, int &y1, int &x2, int &y2, int &x_pt, int &y_ctr)
{
  int best_idx = -1;
  float best_conf = 0.0f;
  for (size_t i = 0; i < dets.size(); ++i)
  {
    std::cerr << "class=" << dets[i].class_id << std::endl;
    if (dets[i].class_id == 8 && dets[i].conf > best_conf)
    {
      best_conf = dets[i].conf;
      best_idx = int(i);
    }
  }
  if (best_idx == -1)
    return false;
  const auto &d = dets[best_idx];
  x1 = d.box.x;
  y1 = d.box.y;
  x2 = d.box.x + d.box.width;
  y2 = d.box.y + d.box.height;
  y_ctr = (y1 + y2) / 2;
  x_pt = (side == "left") ? x1 : x2;
  return true;
}

int main(int argc, char **argv)
{
  Args args;
  if (!parse_args(argc, argv, args))
    return 1;

  if (!args.save_dir.empty())
  {
    fs::create_directories(args.save_dir);
  }

  cv::VideoCapture cap(args.video);
  if (!cap.isOpened())
  {
    std::cerr << "ERROR: cannot open video " << args.video << std::endl;
    return 1;
  }
  int total = int(cap.get(cv::CAP_PROP_FRAME_COUNT));
  if (!(0 <= args.start && args.start < total))
  {
    std::cerr << "ERROR: start frame " << args.start << " out of range [0…" << (total - 1) << "]\n";
    return 1;
  }

  // Load YOLOv8 ONNX model (download from Ultralytics if needed)
  std::string model_path = "yolov8s.onnx";
  cv::dnn::Net net;
  try
  {
    net = cv::dnn::readNetFromONNX(model_path);
  }
  catch (const std::exception &e)
  {
    std::cerr << "ERROR loading YOLOv8s ONNX model: " << e.what() << std::endl;
    return 1;
  }

  cap.set(cv::CAP_PROP_POS_FRAMES, args.start);
  cv::Mat frame;
  if (!cap.read(frame))
  {
    std::cerr << "ERROR: cannot read frame " << args.start << std::endl;
    return 1;
  }

  // Preprocessing
  int inpSize = 640;
  float scale;
  cv::Mat pad;
  cv::Mat blob_img = letterbox(frame, inpSize, {114, 114, 114}, true, false, true, &pad, &scale);
  cv::Mat blob = cv::dnn::blobFromImage(blob_img, 1.0 / 255.0, cv::Size(inpSize, inpSize), cv::Scalar(), true, false);

  net.setInput(blob);
  std::vector<cv::Mat> outputs;
  net.forward(outputs, net.getUnconnectedOutLayersNames());
  // Output shape: [1, 84, 8400]
  int num_classes = 80;
  int pad_w = int(pad.at<float>(0, 0));
  int pad_h = int(pad.at<float>(0, 1));
  std::cout << "Output shape: dims=" << outputs[0].dims << " sizes=";
  for (int i = 0; i < outputs[0].dims; ++i)
    std::cout << outputs[0].size[i] << " ";
  std::cout << std::endl;
  cv::Mat out = outputs[0]; // shape: [1, 84, 8400]
  std::cout << "out.dims=" << out.dims << " out.size[0]=" << out.size[0] << " out.size[1]=" << out.size[1] << " out.size[2]=" << out.size[2] << std::endl;

  std::vector<Detection> dets = parse_yolov8(out, 0.2, 0.45, num_classes, frame.cols, frame.rows, scale, pad_w, pad_h);
  std::cout << "Detections: " << dets.size() << std::endl;
  for (const auto &d : dets)
  {
    std::cout << "class=" << d.class_id << " conf=" << d.conf << " box=" << d.box << std::endl;
  }
  int x1, y1, x2, y2, prev_x, prev_y;
  if (!best_boat_point(dets, args.side, x1, y1, x2, y2, prev_x, prev_y))
  {
    std::cerr << "ERROR: no 'boat' detected in frame " << args.start << std::endl;
    cv::imshow("Boat Tracking", frame);
    cv::waitKey(0);
    return 1;
  }

  // Annotate & display first frame
  cv::rectangle(frame, {x1, y1}, {x2, y2}, {0, 255, 0}, 2);
  cv::circle(frame, {prev_x, prev_y}, 5, {0, 0, 255}, -1);
  cv::imshow("Boat Tracking", frame);
  cv::waitKey(args.step ? 0 : 1);
  if (!args.save_dir.empty())
  {
    char fname[128];
    snprintf(fname, sizeof(fname), "frame_%06d.png", args.start);
    cv::imwrite((fs::path(args.save_dir) / fname).string(), frame);
  }

  std::cout << "frame\tΔx\tΔy\n";
  int processed = 0;
  int idx = args.start;

  while (true)
  {
    if (args.count > 0 && processed >= args.count)
      break;
    if (!cap.read(frame))
      break;
    idx++;

    blob_img = letterbox(frame, inpSize, {114, 114, 114}, true, false, true, &pad, &scale);
    blob = cv::dnn::blobFromImage(blob_img, 1.0 / 255.0, cv::Size(inpSize, inpSize), cv::Scalar(), true, false);
    net.setInput(blob);
    net.forward(outputs, net.getUnconnectedOutLayersNames());

    cv::Mat out = outputs[0]; // shape: [1, 84, 8400]

    dets = parse_yolov8(out, 0.2, 0.45, num_classes, frame.cols, frame.rows, scale, pad_w, pad_h);
    std::cout << "Detections: " << dets.size() << std::endl;
    for (const auto &d : dets)
    {
      std::cout << "class=" << d.class_id << " conf=" << d.conf << " box=" << d.box << std::endl;
    }
    int cx, cy;
    bool found = best_boat_point(dets, args.side, x1, y1, x2, y2, cx, cy);
    if (!found)
    {
      std::cout << idx << "\tFAIL\tFAIL\n";
    }
    else
    {
      int dx = cx - prev_x, dy = cy - prev_y;
      prev_x = cx;
      prev_y = cy;
      std::cout << idx << "\t" << dx << "\t" << dy << "\n";
      cv::rectangle(frame, {x1, y1}, {x2, y2}, {0, 255, 0}, 2);
      cv::circle(frame, {cx, cy}, 5, {0, 0, 255}, -1);
    }
    cv::imshow("Boat Tracking", frame);
    int key = cv::waitKey(args.step ? 0 : 1) & 0xFF;
    if (key == 'q' || key == 27)
      break;
    if (!args.save_dir.empty())
    {
      char fname[128];
      snprintf(fname, sizeof(fname), "frame_%06d.png", idx);
      cv::imwrite((fs::path(args.save_dir) / fname).string(), frame);
    }
    processed++;
  }
  cap.release();
  cv::destroyAllWindows();
  return 0;
}

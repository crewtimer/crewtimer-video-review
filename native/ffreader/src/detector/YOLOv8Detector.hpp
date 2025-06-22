#pragma once
#include <opencv2/opencv.hpp>
#include <opencv2/dnn.hpp>
#include <iostream>
#include <vector>
#include <string>
#include <algorithm>

struct Detection {
    int class_id;
    float confidence;
    cv::Rect box;
};

class YOLOv8Detector {
public:
    YOLOv8Detector(const std::string& model_path, float conf_thresh = 0.1f, float nms_thresh = 0.45f, int input_size = 640, bool debug = false)
        : conf_thresh_(conf_thresh), nms_thresh_(nms_thresh), input_size_(input_size), debug_(debug)
    {
        if (debug_) std::cout << "[DEBUG] Loading ONNX model: " << model_path << std::endl;
        net_ = cv::dnn::readNetFromONNX(model_path);
        net_.setPreferableBackend(cv::dnn::DNN_BACKEND_OPENCV);
        net_.setPreferableTarget(cv::dnn::DNN_TARGET_CPU);
    }

    std::vector<Detection> detect(const cv::Mat& image) {
        float scale;
        int dx, dy;
        cv::Mat padded = letterbox(image, input_size_, scale, dx, dy);

        cv::Mat blob = cv::dnn::blobFromImage(padded, 1.0 / 255.0, cv::Size(), cv::Scalar(), true, false);
        net_.setInput(blob.clone());

        std::vector<cv::Mat> outputs;
        net_.forward(outputs, net_.getUnconnectedOutLayersNames());

        if (debug_) {
            std::cout << "[DEBUG] outputs[0] isContinuous=" << outputs[0].isContinuous()
                      << " total=" << outputs[0].total() << std::endl;
            std::cout << "[DEBUG] Output Shape: [";
            for (int i = 0; i < outputs[0].dims; ++i)
                std::cout << outputs[0].size[i] << (i < outputs[0].dims-1 ? ", " : "");
            std::cout << "]" << std::endl;
        }

        return parseDetections(outputs[0], scale, dx, dy, image.size());
    }


    /**
    * @brief Find the largest detection for a given class id.
    * @param detections The vector of Detection results.
    * @param class_id The class id to search for.
    * @param out_detection Output parameter to receive the largest Detection (if found).
    * @return true if a detection was found, false otherwise.
    */
    bool getLargestDetectionForClass(const std::vector<Detection>& detections, int class_id, Detection& out_detection) const {
        bool found = false;
        double max_area = 0.0;
        for (const auto& det : detections) {
            if (det.class_id == class_id) {
                double area = static_cast<double>(det.box.area());
                if (!found || area > max_area) {
                    max_area = area;
                    out_detection = det;
                    found = true;
                }
            }
        }
        return found;
    }

    /**
    * @brief Compute the delta position (x, y) for both the left and right sides between two Detection bounding boxes.
    * @param det1 The first Detection.
    * @param det2 The second Detection.
    * @return A struct containing delta_left_x, delta_left_y, delta_right_x, delta_right_y.
    */
    struct DetectionDelta {
        int delta_left_x;
        int delta_left_y;
        int delta_right_x;
        int delta_right_y;
    };

    static DetectionDelta getDetectionDelta(const Detection& det1, const Detection& det2) {
        DetectionDelta delta;
        // Left side: top-left corner
        delta.delta_left_x = det2.box.x - det1.box.x;
        delta.delta_left_y = det2.box.y - det1.box.y;
        // Right side: bottom-right corner
        delta.delta_right_x = (det2.box.x + det2.box.width) - (det1.box.x + det1.box.width);
        delta.delta_right_y = (det2.box.y + det2.box.height) - (det1.box.y + det1.box.height);
        return delta;
    }

private:
    cv::dnn::Net net_;
    float conf_thresh_;
    float nms_thresh_;
    int input_size_;
    bool debug_;

    cv::Mat letterbox(const cv::Mat& src, int target_size, float& scale, int& dx, int& dy) const {
        int w = src.cols, h = src.rows;
        scale = std::min(target_size / (float)w, target_size / (float)h);
        int nw = int(w * scale), nh = int(h * scale);
        dx = (target_size - nw) / 2;
        dy = (target_size - nh) / 2;
        cv::Mat resized;
        cv::resize(src, resized, cv::Size(nw, nh));
        cv::Mat output = cv::Mat::zeros(target_size, target_size, src.type());
        resized.copyTo(output(cv::Rect(dx, dy, nw, nh)));
        return output;
    }

    std::vector<Detection> parseDetections(const cv::Mat& output, float scale, int dx, int dy, const cv::Size& original_size) const {
        const int num_channels = output.size[1];
        const int num_classes = num_channels - 4;
        const int num_preds = output.size[2];
        std::vector<Detection> dets;

        if (debug_) {
            std::cout << "[DEBUG] Output tensor shape: [";
            for (int i = 0; i < output.dims; ++i)
                std::cout << output.size[i] << (i < output.dims-1 ? ", " : "");
            std::cout << "]" << std::endl;
            std::cout << "[DEBUG] Number of class channels: " << num_classes << std::endl;
        }

        int debug_pred_limit = debug_ ? 10 : 0;
        int debug_det_limit = debug_ ? 10 : 0;
        int debug_nms_limit = debug_ ? 10 : 0;
        int debug_det_count = 0;

        for (int i = 0; i < num_preds; ++i) {
            float x_c = output.at<float>(0, 0, i);
            float y_c = output.at<float>(0, 1, i);
            float w   = output.at<float>(0, 2, i);
            float h   = output.at<float>(0, 3, i);
            if (debug_ && i < debug_pred_limit) {
                std::cout << "[DEBUG] Pred " << i << " x_c=" << x_c << " y_c=" << y_c
                          << " w=" << w << " h=" << h << std::endl;
            }

            for (int cls = 0; cls < num_classes; ++cls) {
                float cls_conf = output.at<float>(0, 4 + cls, i);
                float conf = cls_conf;
                if (conf > conf_thresh_) {
                    if (debug_ && debug_det_count < debug_det_limit) {
                        std::cout << "[DEBUG] Det " << debug_det_count << " pred=" << i
                                  << " class=" << cls
                                  << " cls_conf=" << cls_conf
                                  << " box=(" << x_c << "," << y_c << "," << w << "," << h << ")"
                                  << std::endl;
                    }
                    ++debug_det_count;

                    float x1 = x_c - w / 2.0f;
                    float y1 = y_c - h / 2.0f;
                    float x2 = x_c + w / 2.0f;
                    float y2 = y_c + h / 2.0f;

                    int left   = std::max(int((x1 - dx) / scale), 0);
                    int top    = std::max(int((y1 - dy) / scale), 0);
                    int right  = std::min(int((x2 - dx) / scale), original_size.width - 1);
                    int bottom = std::min(int((y2 - dy) / scale), original_size.height - 1);

                    dets.push_back({cls, conf, cv::Rect(left, top, right - left, bottom - top)});
                }
            }
        }

        if (debug_) std::cout << "[DEBUG] Total raw detections above threshold: " << dets.size() << std::endl;

        // Apply NMS
        std::vector<int> indices;
        std::vector<cv::Rect> boxes;
        std::vector<float> scores;
        for (const auto& d : dets) {
            boxes.push_back(d.box);
            scores.push_back(d.confidence);
        }
        cv::dnn::NMSBoxes(boxes, scores, conf_thresh_, nms_thresh_, indices);

        if (debug_) {
            std::cout << "[DEBUG] NMS kept " << indices.size() << " detections." << std::endl;
            for (size_t i = 0; i < indices.size() && i < debug_nms_limit; ++i) {
                const Detection& d = dets[indices[i]];
                std::cout << "[DEBUG] NMS Det " << i << ": class=" << d.class_id
                          << " conf=" << d.confidence
                          << " box=(" << d.box.x << "," << d.box.y << "," << d.box.width << "," << d.box.height << ")"
                          << std::endl;
            }
        }

        std::vector<Detection> results;
        for (int idx : indices)
            results.push_back(dets[idx]);
        return results;
    }

};
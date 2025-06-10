// #define CV_THROW_IF_TYPE_MISMATCH(src_type_info, dst_type_info)

#include "FrameUtils.hpp"
#include <algorithm>
#include <iostream>
#include <memory>
#include <opencv2/opencv.hpp>
#include <opencv2/tracking/tracking.hpp>
#include <string>
#include <vector>

extern "C"
{
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/imgutils.h>
#include <libavutil/opt.h>
}

using namespace cv;
using namespace std;

/**
 * @brief Sharpens the input image using a convolution kernel.
 *
 * @param src The input image (cv::Mat).
 * @param dst The output sharpened image (cv::Mat).
 */
void sharpenImage(const cv::Mat &src, cv::Mat &dst)
{
  // Define the sharpening kernel
  cv::Mat kernel = (cv::Mat_<float>(3, 3) << 0, -1, 0, -1, 5, -1, 0, -1, 0);

  // Apply the filter
  cv::filter2D(src, dst, src.depth(), kernel);
}

/**
 * Finds the first peak in an array.
 *
 * @param arr The array of integers to search through.
 * @param dir The direction to search in (positive for right-to-left, negative
 * for left-to-right).
 * @return The index of the first peak found, or -1 if no peak is found.
 */
size_t findFirstPeak(const vector<int> &arr, int dir, int minLevel)
{
  if (dir > 0)
  { // Search from right to left
    for (auto i = arr.size() - 1; i >= 12; i--)
    {
      if (arr[i] > minLevel && arr[i] > arr[i - 1] && arr[i] > arr[i - 2] &&
          arr[i] > arr[i - 3] && arr[i] > arr[i - 4] && arr[i] > arr[i - 10])
      {
        return i;
      }
    }
  }
  else
  { // Search from left to right
    for (size_t i = 0; i < arr.size() - 12; i++)
    {
      if (arr[i] > minLevel && arr[i] > arr[i + 1] && arr[i] > arr[i + 2] &&
          arr[i] > arr[i + 3] && arr[i] > arr[i + 4] && arr[i] > arr[i + 10])
      {
        return i;
      }
    }
  }

  return 0; // No peak found
}

int findPeak(const vector<int> &hist)
{
  size_t negPeak = findFirstPeak(hist, -1, 60);
  size_t posPeak = findFirstPeak(hist, 1, 60);
  if (negPeak == 0 && posPeak == 0)
  {
    return 1000;
  }

  // Ignore one pixel on either side of the zero point (10 slots)
  if (posPeak < hist.size() / 2 + 10)
  {
    // posPeak no good, how about neg peak?
    if (negPeak <= hist.size() / 2 - 10)
    {
      return negPeak;
    }
    else
    {
      return 1000;
    }
  }
  if (negPeak > hist.size() / 2 - 10)
  {
    // negPeak no good, how about pos peak?
    if (posPeak > hist.size() / 2 + 10)
    {
      return posPeak;
    }
    else
    {
      return 1000;
    }
  }
  auto peak = (hist[negPeak] > hist[posPeak]) ? negPeak : posPeak;

  return peak;
}

/**
 * Calculates the motion vectors from the optical flow data.
 *
 * @param flow The optical flow matrix.
 * @return An ImageMotion struct containing the x and y motion.
 */
ImageMotion calculateMotion(const Mat &flow)
{
  // Initialize histograms for x and y components of the flow
  vector<int> histx(2000, 0);
  vector<int> histy(2000, 0);

  // Populate histograms with flow data
  for (int y = 0; y < flow.rows; y++)
  {
    for (int x = 0; x < flow.cols; x++)
    {
      const Vec2f &flowAtXY = flow.at<Vec2f>(y, x);
      double fx = min(99.0f, max(-99.0f, flowAtXY[0]));
      histx[static_cast<int>(round(10 * fx)) + 1000]++;

      double fy = min(99.0f, max(-99.0f, flowAtXY[1]));
      histy[static_cast<int>(round(10 * fy)) + 1000]++;
    }
  }

  for (auto i = 0; i < histx.size(); i++)
  {
    if (histx[i])
    {
      std::cout << int(i - histx.size() / 2) << ": " << histx[i] << std::endl;
    }
  }

  int maxX = findPeak(histx);
  int maxY = findPeak(histy);

  return {(maxX - 1000) / 10.0, (maxY - 1000) / 10.0, 0, true};
}

/**
 * @brief Applies a scene shift to the given frame based on the specified motion
 * and percentage.
 * @param frame The input frame to which the shift will be applied.
 * @param motion The motion parameters containing x and y shifts.
 * @param percentage The percentage of the motion to apply.
 * @return The shifted frame as a new Mat object.
 */
Mat applySceneShift(const Mat &frame, const ImageMotion &motion,
                    double percentage)
{
  // Create the transformation matrix for affine transformation
  Mat M = (Mat_<double>(2, 3) << 1, 0, motion.x * percentage, 0, 1,
           motion.y * percentage);

  // Create an output Mat to hold the shifted frame
  Mat shifted;

  // Apply the affine transformation
  warpAffine(frame, shifted, M, frame.size());

  // Return the shifted frame
  return shifted;
}

/**
 * @brief Applies a positive shift to matA, a negative shift to matB, and blends
 * them according to a given percentage.
 *
 * @param matA The first input image (cv::Mat).
 * @param matB The second input image (cv::Mat).
 * @param motion The motion vector (cv::Point2f).
 * @param percentage The blending percentage (float).
 * @return cv::Mat The blended image.
 */
cv::Mat applySceneShiftAndBlend(const cv::Mat &matA, const cv::Mat &matB,
                                const ImageMotion &motion, float percentage)
{
  cv::Mat M_A = (cv::Mat_<double>(2, 3) << 1, 0, motion.x * percentage, 0, 1,
                 motion.y * percentage);
  cv::Mat M_B = (cv::Mat_<double>(2, 3) << 1, 0, -motion.x * (1 - percentage),
                 0, 1, -motion.y * (1 - percentage));

  cv::Mat shiftedA, shiftedB;
  cv::Size size = matA.size();

  // Apply the affine transformations
  cv::warpAffine(matA, shiftedA, M_A, size);
  cv::warpAffine(matB, shiftedB, M_B, size);

  // Blending the two shifted images
  cv::Mat blended;
  cv::addWeighted(shiftedA, 1 - percentage, shiftedB, percentage, 0, blended);

  return blended;
}

Mat calculateOpticalFlowBetweenFrames(const Mat &frame1, const Mat &frame2,
                                      Rect roi)
{
  Mat frame1Gray, frame2Gray;
  cvtColor(frame1, frame1Gray, COLOR_RGBA2GRAY);
  cvtColor(frame2, frame2Gray, COLOR_RGBA2GRAY);

  Mat flow;
  // calcOpticalFlowFarneback(frame1Gray(roi), frame2Gray(roi), flow, 0.5, 3,
  // 15,
  //                          3, 5, 1.2, 0);
  // calcOpticalFlowFarneback(frame1Gray(roi), frame2Gray(roi), flow, 0.5, 5, 25,
  //                          3, 7, 1.5, 0);
  calcOpticalFlowFarneback(frame1Gray(roi), frame2Gray(roi), flow, 0.5, 6, 40, 5, 9, 1.5, 0);

  return flow;
}

/**
 * @brief Generate a time/position frame between the two provided frames
 *
 * @param frameA
 * @param frameB
 * @param pctAtoB Fraction of time from frameA to frameB. 0.5 is half way.
 * @param xPosition The center x position of the flow estimation
 * @param pixelRange The pixel range on either side of xPosition to use for the
 * estimate
 * @param blend True to blend frameA and frameB, otherwise frameA is shifted
 * @return FrameInfo The interpolated frame
 */
const std::shared_ptr<FrameInfo>
generateInterpolatedFrame(const std::shared_ptr<FrameInfo> frameA,
                          const std::shared_ptr<FrameInfo> frameB,
                          double pctAtoB, FrameRect roi, bool blend)
{
  Mat matA(frameA->height, frameA->width, CV_8UC4,
           (void *)frameA->data->data());
  Mat matB(frameB->height, frameB->width, CV_8UC4,
           (void *)frameB->data->data());
  ImageMotion motion = frameA->motion;

  if (!motion.valid || motion.x == 0 || frameA->roi != roi && roi.width > 0 && roi.height > 0)
  {

    // // std::cerr << "Calculating optical flow" << std::endl;
    Mat flow = calculateOpticalFlowBetweenFrames(
        matA, matB, {roi.x, roi.y, roi.width, roi.height});
    motion = calculateMotion(flow);
    std::cerr << "optical dx=" << motion.x << std::endl;
    // frameA->motion = motion;
    // frameA->roi = roi;

    Mat frame1Gray, frame2Gray;
    cv::Mat matA(frameA->height, frameA->width, CV_8UC4, (void *)frameA->data->data());
    cv::Mat matB(frameB->height, frameB->width, CV_8UC4, (void *)frameB->data->data());

    cv::Rect roi_rect(roi.x, roi.y, roi.width, roi.height);

    cv::Mat matA_roi = matA(roi_rect);
    cv::Mat matB_roi = matB(roi_rect);

    cv::Mat matA_gray, matB_gray;
    cv::cvtColor(matA_roi, matA_gray, cv::COLOR_RGBA2BGR);
    cv::cvtColor(matB_roi, matB_gray, cv::COLOR_RGBA2BGR);

    cv::TrackerCSRT::Params csrtParams;
    // csrtParams.template_size = 80; // 80;
    // csrtParams.padding = 0.3;
    // csrtParams.psr_threshold = 0.1;
    cv::Ptr<cv::Tracker> tracker = cv::TrackerCSRT::create(csrtParams); // cv::TrackerKCF::create();
    cv::Rect bbox((0), (0), (matA_gray.cols), (matA_gray.rows));

    tracker->init(matA_gray, bbox);
    cv::Rect prevBox = bbox;
    bool success = tracker->update(matB_gray, bbox);
    if (success)
    {
      std::cerr << "pbox={" << prevBox.x << "," << prevBox.y << "," << prevBox.width << "," << prevBox.height << "}" << std::endl;
      std::cerr << "bbox={" << bbox.x << "," << bbox.y << "," << bbox.width << "," << bbox.height << "}" << std::endl;
      prevBox = bbox;
      tracker->init(matA_gray, bbox);
      success = tracker->update(matB_gray, bbox);
    }

    if (success)
    {
      std::cerr << "pbox={" << prevBox.x << "," << prevBox.y << "," << prevBox.width << "," << prevBox.height << "}" << std::endl;
      std::cerr << "bbox={" << bbox.x << "," << bbox.y << "," << bbox.width << "," << bbox.height << "}" << std::endl;
      // Compute velocity (e.g., center x-movement)
      double dx = bbox.x + bbox.width / 2 - (prevBox.x + prevBox.width / 2);
      double dy = bbox.y + bbox.height / 2 - (prevBox.y + prevBox.height / 2);
      std::cerr << "dx=" << dx << " dy=" << dy << std::endl;
      motion.x = dx;
      motion.y = dy;
      motion.valid = true;
      frameA->motion = motion;
      frameA->roi = roi;
    }
    else
    {
      std::cerr << "KCF Fail" << std::endl;
      frameA->motion.valid = false;
    }
  }
  std::cerr << "Motion=" << motion.x << "," << motion.y << " px/frame" << std::endl;

  // motion.y = 0;

  // if (motion.x == 0) {
  //   // No motion detected
  //   std::cout << "No motion detected" << std::endl;
  //   auto result = pctAtoB >= 0.5 ? frameB : frameA;
  //   result->motion = motion;
  //   return result;
  // }

  Mat resultFrameMat;
  if (blend)
  {
    resultFrameMat = applySceneShiftAndBlend(matA, matB, motion, pctAtoB);
  }
  else
  {
    resultFrameMat = applySceneShift(matA, motion, pctAtoB);
  }

  auto resultFrame = std::make_shared<FrameInfo>(*frameA);
  resultFrame->data = std::make_shared<vector<uint8_t>>(
      vector<uint8_t>(resultFrameMat.data,
                      resultFrameMat.data +
                          resultFrameMat.total() * resultFrameMat.elemSize()));
  resultFrame->tsMicro =
      frameA->tsMicro + (frameB->tsMicro - frameA->tsMicro) * pctAtoB + 0.5;
  resultFrame->timestamp = (resultFrame->tsMicro + 500) / 1000;
  resultFrame->frameNum =
      frameA->frameNum + (frameB->frameNum - frameA->frameNum) * pctAtoB;

  motion.dt = (frameB->tsMicro - frameA->tsMicro);
  resultFrame->motion = motion;

  return resultFrame;
}

void sharpenFrame(const std::shared_ptr<FrameInfo> frameA)
{
  // Convert the std::vector<uint8_t> to a cv::Mat
  cv::Mat img(frameA->height, frameA->width, CV_8UC4, frameA->data->data());

  // Create a kernel for sharpening
  cv::Mat kernel = (cv::Mat_<float>(3, 3) << 0, -1, 0, -1, 5, -1, 0, -1, 0);

  // Apply the filter in-place
  cv::filter2D(img, img, img.depth(), kernel);
}

/**
 * @brief Saves a frame as a PNG file using OpenCV.
 *
 * This function takes a `FrameInfo` object, extracts the RGBA data,
 * and saves it as a PNG image using the OpenCV library.
 *
 * @param frameInfo A shared pointer to a `FrameInfo` object containing the
 * frame data.
 * @param outputFileName The name of the output PNG file.
 *
 * @note The `frameInfo` object must contain valid RGBA data, and the `width`
 * and `height` fields must be set appropriately.
 *
 * @warning If the `frameInfo` object is invalid, the function will print an
 * error message and return without saving an image.
 */
void saveFrameAsPNG(const std::shared_ptr<FrameInfo> &frameInfo,
                    const std::string &outputFileName)
{
  if (!frameInfo || !frameInfo->data || frameInfo->data->empty() ||
      frameInfo->width <= 0 || frameInfo->height <= 0)
  {
    std::cerr << "Invalid frame data or dimensions." << std::endl;
    return;
  }

  // Find the PNG encoder
  const AVCodec *codec = avcodec_find_encoder(AV_CODEC_ID_PNG);
  if (!codec)
  {
    std::cerr << "PNG codec not found." << std::endl;
    return;
  }

  // Create a codec context
  AVCodecContext *codecContext = avcodec_alloc_context3(codec);
  if (!codecContext)
  {
    std::cerr << "Could not allocate codec context." << std::endl;
    return;
  }

  // Set codec parameters
  codecContext->bit_rate = 400000;
  codecContext->width = frameInfo->width;
  codecContext->height = frameInfo->height;
  codecContext->pix_fmt = AV_PIX_FMT_RGBA; // Input pixel format
  codecContext->time_base = {1, 25};       // Frame rate

  // Open the codec
  if (avcodec_open2(codecContext, codec, nullptr) < 0)
  {
    std::cerr << "Could not open codec." << std::endl;
    avcodec_free_context(&codecContext);
    return;
  }

  // Allocate an AVFrame and set its properties
  AVFrame *frame = av_frame_alloc();
  if (!frame)
  {
    std::cerr << "Could not allocate frame." << std::endl;
    avcodec_free_context(&codecContext);
    return;
  }
  frame->format = codecContext->pix_fmt;
  frame->width = codecContext->width;
  frame->height = codecContext->height;

  // Allocate the frame buffer
  if (av_image_alloc(frame->data, frame->linesize, frame->width, frame->height,
                     codecContext->pix_fmt, 32) < 0) {
    std::cerr << "Could not allocate frame buffer." << std::endl;
    av_frame_free(&frame);
    avcodec_free_context(&codecContext);
    return;
  }

  // Copy the RGBA data from FrameInfo into the frame
  // int bufferSize = av_image_get_buffer_size(codecContext->pix_fmt, frame->width, frame->height, 1);
  auto destlinesize = frame->linesize[0];
  auto srclinesize = frameInfo->linesize;
  uint8_t *srcdata = frameInfo->data->data();
  uint8_t *destdata = frame->data[0];
  for (int i = 0; i < frame->height; i++)
  {
    memcpy(destdata, srcdata, srclinesize);
    srcdata += srclinesize;
    destdata += destlinesize;
  }

  // Create a packet to hold encoded data
  AVPacket *pkt = av_packet_alloc();
  if (!pkt)
  {
    std::cerr << "Could not allocate packet." << std::endl;
    av_freep(&frame->data[0]);
    av_frame_free(&frame);
    avcodec_free_context(&codecContext);
    return;
  }

  // Encode the frame into a PNG
  int ret = avcodec_send_frame(codecContext, frame);
  if (ret < 0)
  {
    std::cerr << "Error sending frame to codec." << std::endl;
    av_packet_free(&pkt);
    av_freep(&frame->data[0]);
    av_frame_free(&frame);
    avcodec_free_context(&codecContext);
    return;
  }

  ret = avcodec_receive_packet(codecContext, pkt);
  if (ret < 0)
  {
    std::cerr << "Error receiving packet from codec." << std::endl;
    av_packet_free(&pkt);
    av_freep(&frame->data[0]);
    av_frame_free(&frame);
    avcodec_free_context(&codecContext);
    return;
  }

  // Write the encoded data to a file
  FILE *outputFile = fopen(outputFileName.c_str(), "wb");
  if (!outputFile)
  {
    std::cerr << "Could not open output file." << std::endl;
    av_packet_free(&pkt);
    av_freep(&frame->data[0]);
    av_frame_free(&frame);
    avcodec_free_context(&codecContext);
    return;
  }
  fwrite(pkt->data, 1, pkt->size, outputFile);
  fclose(outputFile);

  // Free resources
  av_packet_free(&pkt);
  av_freep(&frame->data[0]);
  av_frame_free(&frame);
  avcodec_free_context(&codecContext);

  std::cout << "Image saved successfully to " << outputFileName << std::endl;
}

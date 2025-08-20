// #define CV_THROW_IF_TYPE_MISMATCH(src_type_info, dst_type_info)

#include "FrameUtils.hpp"
#include <algorithm>
#include <iostream>
#include <memory>
#include <opencv2/opencv.hpp>
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

struct BowMatch
{
  cv::Point2f matched_center_xy; // center of best match in B
  double score;                  // NCC score (higher is better for TM_CCOEFF_NORMED)
  cv::Rect template_in_A;        // patch_w × patch_h rect in A (reporting)
  cv::Rect search_roi_in_B;      // ROI searched in B
  cv::Rect match_rect_in_B;      // patch_w × patch_h rect of best match in B
};

static inline cv::Mat toGray(const cv::Mat &img)
{
  if (img.channels() == 1)
    return img;
  cv::Mat g;
  cv::cvtColor(img, g, cv::COLOR_BGR2GRAY);
  return g;
}

// --- helper: subpixel refinement on the response map peak --------------------
static inline cv::Point2f refinePeakSubpixel(const cv::Mat &res,
                                             const cv::Point &bestTL,
                                             bool is_sqdiff_method)
{
  // We want to refine the *peak*. For SQDIFF we invert the sign so max-peak logic works.
  // Parabolic 1D interpolation formula:
  //   delta = 0.5*(L - R) / (L - 2*C + R), where L=left, C=center, R=right
  auto val = [&](int y, int x) -> double
  {
    double v = static_cast<double>(res.at<float>(y, x));
    return is_sqdiff_method ? -v : v; // invert for SQDIFF to make peak be a maximum
  };

  int u = bestTL.x;
  int v = bestTL.y;

  // Need a 3x3 neighborhood inside res
  if (u <= 0 || v <= 0 || u >= res.cols - 1 || v >= res.rows - 1)
  {
    return cv::Point2f(0.f, 0.f);
  }

  double c = val(v, u);
  double lx = val(v, u - 1), rx = val(v, u + 1);
  double ty = val(v - 1, u), by = val(v + 1, u);

  double denom_x = (lx - 2.0 * c + rx);
  double denom_y = (ty - 2.0 * c + by);

  double dx = 0.0, dy = 0.0;
  if (std::abs(denom_x) > 1e-12)
    dx = 0.5 * (lx - rx) / denom_x;
  if (std::abs(denom_y) > 1e-12)
    dy = 0.5 * (ty - by) / denom_y;

  // Clamp to a sensible range (subpixel offset cannot exceed one pixel)
  dx = std::max(-1.0, std::min(1.0, dx));
  dy = std::max(-1.0, std::min(1.0, dy));
  return cv::Point2f(static_cast<float>(dx), static_cast<float>(dy));
}

/**
 * Find the location in imgB that best matches a patch centered at xy_in_A in imgA.
 * - Patch can be RECTANGULAR: patch_w × patch_h
 * - Search limited to a window where the TEMPLATE CENTER stays within ±search_radius of (x,y)
 * - Uses cv::matchTemplate (default TM_CCOEFF_NORMED)
 *
 * Assumes A and B have same scale/projection (consecutive frames or similar).
 */
BowMatch find_bow_in_image(
    const cv::Mat &imgA,
    const cv::Mat &imgB,
    const cv::Point2f &xy_in_A,
    int patch_w = 32,
    int patch_h = 32,
    int search_radius = 128,
    int method = cv::TM_CCOEFF_NORMED)
{
  BowMatch out;
  out.score = 0;

  if (imgA.empty() || imgB.empty())
  {
    std::cerr << "Empty input image(s)." << std::endl;
    return out;
  }
  if (patch_w <= 0 || patch_h <= 0)
  {
    std::cerr << "Patch dimensions must be positive." << std::endl;
    return out;
  }

  cv::Mat grayA = (imgA.channels() == 1) ? imgA : (cv::Mat)cv::Mat();
  if (grayA.empty())
    cv::cvtColor(imgA, grayA, cv::COLOR_BGR2GRAY);
  cv::Mat grayB = (imgB.channels() == 1) ? imgB : (cv::Mat)cv::Mat();
  if (grayB.empty())
    cv::cvtColor(imgB, grayB, cv::COLOR_BGR2GRAY);

  const int half_w = patch_w / 2;
  const int half_h = patch_h / 2;

  // Template centered on (x,y) with padding
  cv::Mat paddedA;
  cv::copyMakeBorder(grayA, paddedA, half_h, half_h, half_w, half_w, cv::BORDER_REPLICATE);

  const int x = cvRound(xy_in_A.x);
  const int y = cvRound(xy_in_A.y);

  cv::Rect tplRectInPadded(x, y, patch_w, patch_h);
  if ((tplRectInPadded & cv::Rect(0, 0, paddedA.cols, paddedA.rows)) != tplRectInPadded)
  {
    std::cerr << "Template extraction failed; check coords/patch size." << std::endl;
    return out;
  }
  cv::Mat templ = paddedA(tplRectInPadded).clone();

  cv::Rect template_in_A(x - half_w, y - half_h, patch_w, patch_h);
  template_in_A &= cv::Rect(0, 0, grayA.cols, grayA.rows);

  // Search ROI: ensure template center stays within ±radius of (x,y)
  int tl_min_x = x - search_radius - half_w;
  int tl_max_x = x + search_radius - half_w;
  int tl_min_y = y - search_radius - half_h;
  int tl_max_y = y + search_radius - half_h;

  int rx0 = std::max(0, tl_min_x);
  int ry0 = std::max(0, tl_min_y);
  int rx1 = std::min(grayB.cols, tl_max_x + patch_w);
  int ry1 = std::min(grayB.rows, tl_max_y + patch_h);

  if (rx1 - rx0 < patch_w)
  {
    rx0 = std::max(0, std::min(grayB.cols - patch_w, x - search_radius - half_w));
    rx1 = rx0 + patch_w;
  }
  if (ry1 - ry0 < patch_h)
  {
    ry0 = std::max(0, std::min(grayB.rows - patch_h, y - search_radius - half_h));
    ry1 = ry0 + patch_h;
  }

  cv::Rect searchROI(rx0, ry0, rx1 - rx0, ry1 - ry0);
  if (searchROI.width < patch_w || searchROI.height < patch_h)
  {
    std::cerr << "Search ROI smaller than template." << std::endl;
    return out;
  }

  cv::Mat roiB = grayB(searchROI);

  // Match
  cv::Mat res;
  cv::matchTemplate(roiB, templ, res, method);

  double minVal = 0, maxVal = 0;
  cv::Point minLoc, maxLoc;
  cv::minMaxLoc(res, &minVal, &maxVal, &minLoc, &maxLoc);
  bool is_sqdiff = (method == cv::TM_SQDIFF || method == cv::TM_SQDIFF_NORMED);

  cv::Point bestTL = is_sqdiff ? minLoc : maxLoc;
  double score = is_sqdiff ? (1.0 - minVal) : maxVal;

  // --- Subpixel refinement on response map peak ---
  cv::Point2f peakOffset = refinePeakSubpixel(res, bestTL, is_sqdiff);

  // Map refined top-left back to image B coordinates
  cv::Point2f match_tl_in_B = cv::Point2f(static_cast<float>(searchROI.x + bestTL.x),
                                          static_cast<float>(searchROI.y + bestTL.y)) +
                              peakOffset;

  cv::Rect2f match_rect_in_B_f(match_tl_in_B.x, match_tl_in_B.y,
                               static_cast<float>(patch_w), static_cast<float>(patch_h));
  cv::Point2f matched_center_xy(match_rect_in_B_f.x + 0.5f * patch_w,
                                match_rect_in_B_f.y + 0.5f * patch_h);

  // Package results (keep integer ROI/templ rects as cv::Rect; match_rect can be rounded if needed)
  out.matched_center_xy = matched_center_xy;
  out.score = score;
  out.template_in_A = template_in_A;
  out.search_roi_in_B = searchROI;
  out.match_rect_in_B = cv::Rect(cvRound(match_rect_in_B_f.x),
                                 cvRound(match_rect_in_B_f.y),
                                 patch_w, patch_h);
  return out;
}

// Optional utility to annotate the match on B
void annotate_match_on_B(cv::Mat &imgB_color,
                         const BowMatch &m,
                         const cv::Point2f &xy_in_A,
                         int search_radius = 128)
{
  if (imgB_color.channels() == 1)
    cv::cvtColor(imgB_color, imgB_color, cv::COLOR_GRAY2BGR);

  // Search circle around the original A point coords (assumes same projection for B)
  cv::circle(imgB_color,
             cv::Point(cv::saturate_cast<int>(xy_in_A.x),
                       cv::saturate_cast<int>(xy_in_A.y)),
             search_radius, cv::Scalar(200, 200, 200), 1, cv::LINE_AA);

  // Match rectangle and center dot
  cv::rectangle(imgB_color, m.match_rect_in_B, cv::Scalar(0, 255, 255), 1, cv::LINE_AA);
  cv::circle(imgB_color, m.matched_center_xy, 4, cv::Scalar(0, 255, 0), -1, cv::LINE_AA);
}
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
  Mat matB(frameA->height, frameA->width, CV_8UC4,
           (void *)frameB->data->data());

  ImageMotion motion = frameA->motion;
  if (!motion.valid || motion.x == 0 || frameA->roi != roi)
  {
    cv::Point2f bow_in_A(roi.x + roi.width / 2, roi.y + roi.height / 2); // example click
    BowMatch m = find_bow_in_image(matA, matB, bow_in_A, roi.width, roi.height, 128, cv::TM_CCOEFF_NORMED);

    // std::cout << "Calculating motino for roi=" << roi.x + roi.width / 2 << "," << roi.y + roi.height / 2 << "=" << m.score << std::endl;
    if (m.score > 0.65)
    {
      cv::Point2f v = m.matched_center_xy - bow_in_A;
      motion = {v.x, v.y, 0, true};
      if (std::abs(v.x) > 1)
      {
        frameA->motion = motion;
        // std::cout << "V=" << v.x << "," << v.y << " motion=" << frameA->motion.x << "," << frameA->motion.y << std::endl;
        frameA->roi = roi;
      }
    }
  }

  Mat resultFrameMat;
  if (blend && motion.valid)
  {
    resultFrameMat = applySceneShiftAndBlend(matA, matB, motion, pctAtoB);
  }
  else
  {
    std::cout << "Scene shift " << pctAtoB << "%" << std::endl;
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
    std::cerr << "PNG codec not found." << std::endl; //
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
                     codecContext->pix_fmt, 32) < 0)
  {
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

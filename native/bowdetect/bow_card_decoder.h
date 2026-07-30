#pragma once
/**
 * bow_card_decoder.h
 * ==================
 * Decodes numeric text from a racing-shell bow card image crop and
 * returns the pixel location of each character for highlighting.
 *
 * Architecture
 * ------------
 * The blob-detection and grouping pipeline (OpenCV only) is the same as the
 * Python reference implementation.  Character recognition is handled by a
 * small CRNN ONNX model trained with train_bow_crnn.py.
 *
 * IMPORTANT — model training:
 *   The supplied bow_crnn.onnx must be trained on images that match the exact
 *   preprocessing pipeline used here (upscale → sharpen → threshold → invert).
 *   Run train_bow_crnn.py --mode pipeline to produce a correctly matched model.
 *   See train_bow_crnn.py for full details and the README for quick-start steps.
 *
 * Inference contract (input/output tensor format)
 * -----------------------------------------------
 *   Input  "input"  : float32  (1, 1, 32, W)   — grayscale [0,1], H=32, variable W
 *   Output "output" : float32  (T, 1, NUM_CLS)  — time-major logits (T = W/4)
 *   Decode          : mean-pool over T, argmax over NUM_CLS
 *
 * Dependencies
 * ------------
 *   OpenCV  >= 4.5     (core, imgproc, imgcodecs)
 *   ONNX Runtime >= 1.14
 *
 * Build (CMake)
 * -------------
 *   See CMakeLists.txt.
 *
 * Build (single command)
 * ----------------------
 *   g++ -std=c++17 -O2 bow_card_demo.cpp -o bow_card_demo \
 *       $(pkg-config --cflags --libs opencv4)              \
 *       -I/path/to/onnxruntime/include                     \
 *       -L/path/to/onnxruntime/lib -lonnxruntime
 *
 * Typical usage
 * -------------
 *   BowCardDecoder decoder("bow_crnn.onnx");
 *   cv::Mat frame = cv::imread("crop.png");
 *
 *   auto [text, bbox, charBoxes] = decoder.decode(frame);
 *   std::cout << "Bow number: " << text << "\n";
 *   for (auto& cb : charBoxes)
 *       std::cout << "  '" << cb.ch << "' at " << cb.box << "\n";
 *
 *   BowCardDecoder::annotate(frame, text, bbox, charBoxes, 6);
 *   cv::imwrite("annotated.png", frame);
 */

#include <string>
#include <vector>
#include <algorithm>
#include <numeric>
#include <stdexcept>
#include <cstring>

#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>

#include <onnxruntime_cxx_api.h>


// ─── Public types ─────────────────────────────────────────────────────────────

/** Bounding box + character for one decoded character group. */
struct BowCharBox {
    char     ch;   ///< Decoded character, or '\0' if recognition failed
    cv::Rect box;  ///< Pixel location in the *original* input image
};

/** Return value of BowCardDecoder::decode(). */
struct BowCardResult {
    std::string             text;      ///< Full decoded bow number, e.g. "12"
    cv::Rect                bbox;      ///< Overall bbox (union of all charBoxes)
    std::vector<BowCharBox> charBoxes; ///< Per-character boxes, left-to-right
};


// ─── Decoder ──────────────────────────────────────────────────────────────────

class BowCardDecoder {
public:
    // ── Tuning parameters ─────────────────────────────────────────────────
    struct Params {
        int   scale            = 10;    ///< Upscale factor before thresholding
        float sharpenWeight    = 2.5f;  ///< Unsharp-mask blend weight
        float sharpenSigma     = 1.0f;  ///< Unsharp-mask Gaussian sigma
        int   thresholdValue   = 140;   ///< Binary threshold (0-255)
        int   minBlobArea      = 200;   ///< Min scaled-image blob area (noise filter)
        float topFraction      = 0.65f; ///< Auto-crop: keep top N% (hull filter)
        int   crnnInputH       = 32;    ///< CRNN model input height (px)
        int   crnnInputW       = 64;    ///< CRNN model input width (px)
    };

    /**
     * Construct a decoder and load the ONNX model.
     * @param modelPath  Path to bow_crnn.onnx produced by train_bow_crnn.py.
     * @param params     Optional tuning overrides.
     */
    explicit BowCardDecoder(const std::string& modelPath,
                            Params params = Params{});

    /**
     * Decode a bow card image.
     *
     * @param image  Input image (any depth / channels — converted internally).
     * @param roi    Optional sub-region to restrict processing to.
     *               Pass cv::Rect() to use the whole image.
     * @return       BowCardResult with text, overall bbox, per-char boxes.
     *               All coordinates are in *original image* pixels.
     */
    BowCardResult decode(const cv::Mat& image,
                         cv::Rect roi = cv::Rect()) const;

    /**
     * Draw bounding boxes and the decoded label onto an image in-place.
     *
     * @param image     Image to annotate (modified in-place).
     * @param text      Decoded text for the label.
     * @param bbox      Overall bounding box.
     * @param charBoxes Per-character boxes.
     * @param upscale   Integer scale factor already applied to 'image'.
     *                  Pass 1 when the image is at original resolution;
     *                  pass 6 when you have already upscaled 6× for display.
     */
    static void annotate(cv::Mat& image,
                         const std::string& text,
                         const cv::Rect& bbox,
                         const std::vector<BowCharBox>& charBoxes,
                         int upscale = 1);

    /**
     * Fuzzy-match raw OCR output against a known start list (Levenshtein).
     * Corrects ambiguous pairs such as 0/O and 1/I.
     *
     * @param raw        Raw OCR output, e.g. "F1".
     * @param startList  Known valid bow numbers for this race.
     * @return           Best matching entry, or raw if startList is empty.
     */
    static std::string matchStartList(const std::string& raw,
                                      const std::vector<std::string>& startList);

private:
    // ONNX Runtime session
    Ort::Env             env_;
    Ort::SessionOptions  sessionOpts_;
    Ort::Session         session_;

    Params params_;

    // Charset: index 0 = blank / unknown
    static constexpr const char* CHARSET = "-0123456789";

    // ── Internal helpers ──────────────────────────────────────────────────

    /** Preprocess: upscale → sharpen → binary threshold. */
    cv::Mat preprocess(const cv::Mat& gray) const;

    /** Blob descriptor (scaled-image coordinates). */
    struct Blob { cv::Rect scaledRect; int area; };

    /** Find character-sized blobs, reject hull / timing-post / noise. */
    std::vector<Blob> findBlobs(const cv::Mat& thresh, int imgW) const;

    /** Group overlapping / touching blobs into per-character clusters. */
    std::vector<std::vector<Blob>>
    groupBlobs(const std::vector<Blob>& blobs) const;

    /**
     * Run the CRNN on one character crop.
     * Input : grayscale binary image (white background, black text).
     * Output: single character, or '\0' on failure.
     *
     * Inference:  resize to (crnnInputW × crnnInputH) →
     *             normalise to [0,1] → NCHW tensor →
     *             ONNX session → mean-pool over time → argmax.
     */
    char runCRNN(const cv::Mat& charCrop) const;

    /** Levenshtein edit distance (used by matchStartList). */
    static int levenshtein(const std::string& a, const std::string& b);
};


// ─── Implementation ───────────────────────────────────────────────────────────

inline BowCardDecoder::BowCardDecoder(const std::string& modelPath,
                                       Params params)
    : env_(ORT_LOGGING_LEVEL_WARNING, "BowCardDecoder")
    , session_(env_, modelPath.c_str(), sessionOpts_)
    , params_(params)
{}


inline BowCardResult BowCardDecoder::decode(const cv::Mat& image,
                                             cv::Rect roi) const
{
    // 1. Greyscale
    cv::Mat gray;
    if (image.channels() == 1) gray = image.clone();
    else                        cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);

    // 2. ROI / auto top-crop; record offset for coordinate mapping
    int offsetX = 0, offsetY = 0;
    if (roi.width > 0 && roi.height > 0) {
        gray    = gray(roi);
        offsetX = roi.x;
        offsetY = roi.y;
    } else {
        int topH = static_cast<int>(gray.rows * params_.topFraction);
        gray     = gray(cv::Rect(0, 0, gray.cols, topH));
    }
    int subW = gray.cols;

    // 3-5. Upscale → sharpen → threshold
    cv::Mat thresh = preprocess(gray);

    // 6. Find and group blobs
    auto blobs  = findBlobs(thresh, subW);
    if (blobs.empty()) return {};
    auto groups = groupBlobs(blobs);

    // 7. Decode each group
    BowCardResult result;
    const int scale = params_.scale;
    const int pad   = 20;

    for (auto& group : groups) {
        // Union bbox in scaled coords
        int gx1 = group[0].scaledRect.x;
        int gy1 = group[0].scaledRect.y;
        int gx2 = gx1 + group[0].scaledRect.width;
        int gy2 = gy1 + group[0].scaledRect.height;
        for (auto& b : group) {
            gx1 = std::min(gx1, b.scaledRect.x);
            gy1 = std::min(gy1, b.scaledRect.y);
            gx2 = std::max(gx2, b.scaledRect.x + b.scaledRect.width);
            gy2 = std::max(gy2, b.scaledRect.y + b.scaledRect.height);
        }
        // 8. Map to original image coordinates
        cv::Rect origRect(offsetX + gx1 / scale,
                          offsetY + gy1 / scale,
                          (gx2 - gx1) / scale,
                          (gy2 - gy1) / scale);

        // Use the largest blob for recognition
        auto& mainBlob = *std::max_element(
            group.begin(), group.end(),
            [](const Blob& a, const Blob& b) { return a.area < b.area; });

        const cv::Rect& cr = mainBlob.scaledRect;
        int x1p = std::max(0, cr.x - pad);
        int y1p = std::max(0, cr.y - pad);
        int x2p = std::min(thresh.cols, cr.x + cr.width  + pad);
        int y2p = std::min(thresh.rows, cr.y + cr.height + pad);

        cv::Mat crop = thresh(cv::Rect(x1p, y1p, x2p - x1p, y2p - y1p));

        // Polarity auto-detection:
        //   After thresholding, character strokes are the minority colour.
        //   mean > 128 → mostly white → dark text on white card → keep as-is
        //   mean < 128 → mostly black → white text on dark card → invert
        // The model always receives: black text on white background.
        cv::Mat inv;
        double meanVal = cv::mean(crop)[0];
        if (meanVal > 128.0)
            inv = crop.clone();               // light card: already black-on-white
        else
            cv::bitwise_not(crop, inv);       // dark card: invert to black-on-white

        cv::copyMakeBorder(inv, inv, 20, 20, 20, 20,
                           cv::BORDER_CONSTANT, cv::Scalar(255));

        char ch = runCRNN(inv);
        result.charBoxes.push_back({ch, origRect});
        if (ch != '\0') result.text += ch;
    }

    // Overall bbox
    if (!result.charBoxes.empty()) {
        cv::Rect overall = result.charBoxes[0].box;
        for (auto& cb : result.charBoxes)
            overall |= cb.box;
        result.bbox = overall;
    }
    return result;
}


inline cv::Mat BowCardDecoder::preprocess(const cv::Mat& gray) const
{
    const int scale = params_.scale;

    // Lanczos upscale
    cv::Mat up;
    cv::resize(gray, up, cv::Size(), scale, scale, cv::INTER_LANCZOS4);

    // Unsharp mask
    cv::Mat blurred;
    cv::GaussianBlur(up, blurred, cv::Size(0,0), params_.sharpenSigma);
    cv::Mat sharpened;
    cv::addWeighted(up,       params_.sharpenWeight,
                    blurred, -(params_.sharpenWeight - 1.0f),
                    0.0, sharpened);
    sharpened.convertTo(sharpened, CV_8U);

    // Binary threshold (white text on dark card)
    cv::Mat thresh;
    cv::threshold(sharpened, thresh,
                  params_.thresholdValue, 255, cv::THRESH_BINARY);
    return thresh;
}


inline std::vector<BowCardDecoder::Blob>
BowCardDecoder::findBlobs(const cv::Mat& thresh, int imgW) const
{
    const int scale = params_.scale;
    const float maxCharW =
        std::min(imgW * scale * 0.5f, static_cast<float>(scale * 30));

    cv::Mat labels, statsM, centroids;
    int n = cv::connectedComponentsWithStats(
                thresh, labels, statsM, centroids, 8);

    std::vector<Blob> result;
    for (int i = 1; i < n; ++i) {
        int bx   = statsM.at<int>(i, cv::CC_STAT_LEFT);
        int by   = statsM.at<int>(i, cv::CC_STAT_TOP);
        int bw   = statsM.at<int>(i, cv::CC_STAT_WIDTH);
        int bh   = statsM.at<int>(i, cv::CC_STAT_HEIGHT);
        int area = statsM.at<int>(i, cv::CC_STAT_AREA);
        float aspect = static_cast<float>(bw) / (bh + 1e-5f);

        if (area   >= params_.minBlobArea &&
            bw     <  maxCharW            &&
            bw     >= scale * 3           &&
            bh     >  scale * 4           &&
            aspect >  0.15f               &&
            aspect <  2.5f)
        {
            result.push_back({{bx, by, bw, bh}, area});
        }
    }
    std::sort(result.begin(), result.end(),
              [](const Blob& a, const Blob& b) {
                  return a.scaledRect.x < b.scaledRect.x; });
    return result;
}


inline std::vector<std::vector<BowCardDecoder::Blob>>
BowCardDecoder::groupBlobs(const std::vector<Blob>& blobs) const
{
    // Blobs closer than 1 original pixel belong to the same character
    const int gapThreshold = params_.scale * 1;

    std::vector<std::vector<Blob>> groups;
    groups.push_back({blobs[0]});

    for (size_t i = 1; i < blobs.size(); ++i) {
        int prevRight = 0;
        for (auto& b : groups.back())
            prevRight = std::max(prevRight,
                                 b.scaledRect.x + b.scaledRect.width);
        if (blobs[i].scaledRect.x - prevRight <= gapThreshold)
            groups.back().push_back(blobs[i]);
        else
            groups.push_back({blobs[i]});
    }
    return groups;
}


inline char BowCardDecoder::runCRNN(const cv::Mat& charCrop) const
{
    const int W = params_.crnnInputW;
    const int H = params_.crnnInputH;

    // Resize to fixed (W × H), normalise to [0,1]
    cv::Mat resized;
    cv::resize(charCrop, resized, cv::Size(W, H), 0, 0, cv::INTER_LINEAR);

    cv::Mat floatImg;
    resized.convertTo(floatImg, CV_32F, 1.0 / 255.0);

    // Build NCHW tensor: (1, 1, H, W)
    std::vector<float> inputData(H * W);
    std::memcpy(inputData.data(), floatImg.data, H * W * sizeof(float));

    std::array<int64_t, 4> inputShape{1, 1, H, W};

    auto memInfo = Ort::MemoryInfo::CreateCpu(
        OrtArenaAllocator, OrtMemTypeDefault);

    Ort::Value inputTensor = Ort::Value::CreateTensor<float>(
        memInfo,
        inputData.data(), inputData.size(),
        inputShape.data(), inputShape.size());

    const char* inputNames[]  = {"input"};
    const char* outputNames[] = {"output"};

    auto outputs = session_.Run(
        Ort::RunOptions{nullptr},
        inputNames,  &inputTensor, 1,
        outputNames, 1);

    // Output shape: (T, 1, NUM_CLASSES) — time-major
    auto& outTensor = outputs[0];
    auto  shape     = outTensor.GetTensorTypeAndShapeInfo().GetShape();
    int   seqLen    = static_cast<int>(shape[0]);
    int   numCls    = static_cast<int>(shape[2]);
    const float* logits = outTensor.GetTensorData<float>();

    // Mean-pool over time axis, then argmax
    std::vector<float> pooled(numCls, 0.0f);
    for (int t = 0; t < seqLen; ++t)
        for (int c = 0; c < numCls; ++c)
            pooled[c] += logits[t * numCls + c];   // batch dim = 1, already squeezed

    int bestClass = static_cast<int>(
        std::max_element(pooled.begin(), pooled.end()) - pooled.begin());

    return (bestClass > 0) ? CHARSET[bestClass] : '\0';
}


inline void BowCardDecoder::annotate(cv::Mat& image,
                                      const std::string& text,
                                      const cv::Rect& bbox,
                                      const std::vector<BowCharBox>& charBoxes,
                                      int s)
{
    if (text.empty() || bbox.width == 0) return;

    const cv::Scalar green(0, 220, 0);
    const cv::Scalar cyan(255, 200, 0);
    const int pad   = std::max(2, s);
    const int thick = std::max(1, s / 3);

    // Overall box (green) with label above
    cv::Rect r(bbox.x * s - pad,
               bbox.y * s - pad,
               bbox.width  * s + 2 * pad,
               bbox.height * s + 2 * pad);
    r &= cv::Rect(0, 0, image.cols, image.rows);
    cv::rectangle(image, r, green, thick);
    cv::putText(image, text,
                cv::Point(r.x, std::max(10, r.y - 3)),
                cv::FONT_HERSHEY_SIMPLEX,
                0.55 * s / 3.0, green, thick);

    // Per-character boxes (cyan)
    for (auto& cb : charBoxes) {
        cv::Rect cr(cb.box.x * s, cb.box.y * s,
                    cb.box.width * s, cb.box.height * s);
        cr &= cv::Rect(0, 0, image.cols, image.rows);
        cv::rectangle(image, cr, cyan, std::max(1, s / 4));
    }
}


inline std::string BowCardDecoder::matchStartList(
    const std::string& raw,
    const std::vector<std::string>& startList)
{
    if (startList.empty() || raw.empty()) return raw;
    return *std::min_element(
        startList.begin(), startList.end(),
        [&raw](const std::string& a, const std::string& b) {
            return levenshtein(raw, a) < levenshtein(raw, b);
        });
}


inline int BowCardDecoder::levenshtein(const std::string& a,
                                        const std::string& b)
{
    int m = static_cast<int>(a.size());
    int n = static_cast<int>(b.size());
    std::vector<int> dp(n + 1);
    std::iota(dp.begin(), dp.end(), 0);
    for (int i = 1; i <= m; ++i) {
        std::vector<int> prev = dp;
        dp[0] = i;
        for (int j = 1; j <= n; ++j)
            dp[j] = std::min({prev[j] + 1,
                              dp[j-1] + 1,
                              prev[j-1] + (a[i-1] == b[j-1] ? 0 : 1)});
    }
    return dp[n];
}

#include <string>
#include <deque>

extern "C"
{
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libswscale/swscale.h>
}

// This class heavily leveraged from
// https://github.com/opencv/opencv/blob/a8ec6586118c3f8e8f48549a85f2da7a5b78bcc9/modules/videoio/src/cap_ffmpeg_impl.hpp#L1473

/**
 * @class FFVideoReader
 * @brief A utility class for reading and decoding video frames using FFmpeg.
 *
 * This class provides methods to open a video file, seek to specific frames,
 * and decode frames into various formats (including RGBA). It also manages
 * FFmpeg structures like AVFormatContext, AVCodecContext, and SwsContext,
 * and maintains a small ring buffer of recently decoded frames to facilitate
 * short backward seeking.
 */
class FFVideoReader
{
  /** A pointer to the format context, which holds information about the container format. */
  AVFormatContext *formatContext;

  /** A pointer to the codec context, used for actual video decoding. */
  AVCodecContext *codecContext;

  /** A SwsContext used for pixel format conversion (e.g., YUV -> RGBA). */
  SwsContext *swsContext;

  /** A reusable AVPacket for reading and sending compressed video data to the decoder. */
  AVPacket *packet;

  /** A reusable AVFrame for receiving decoded frames from the decoder. */
  AVFrame *frame;

  /** A reusable AVFrame for storing a frame converted to RGBA pixel format. */
  AVFrame *rgbaFrame;

  /** The index of the video stream within the opened media file. */
  int videoStreamIndex;

  /**
   * A timestamp (PTS or DTS) representing the latest decoded frame.
   * Used as a reference for computing frame numbers and presentation order.
   */
  int64_t picture_pts;

  /**
   * The current decoded frame index (in a time-based sense). Updated whenever
   * a new frame is decoded and aligned via dts_to_frame_number().
   */
  int64_t currentFrameNumber;

  /**
   * The frame index of the very first decoded frame, used to anchor
   * all subsequent frame numbering to zero.
   */
  int64_t firstFrameNumber;

  /**
   * A small ring buffer that stores pairs of (frameNumber, AVFrame*)
   * for recently decoded frames. Facilitates quick short-range backward seeks.
   */
  std::deque<std::pair<int64_t, AVFrame *>> recentFrames;

  /**
   * @brief Converts a decoding timestamp (DTS) to seconds using the stream's time base.
   *
   * @param dts The DTS to be converted.
   * @return The corresponding time in seconds.
   */
  double dts_to_sec(int64_t dts) const;

  /**
   * @brief Converts a decoding timestamp (DTS) to a frame index based on the current FPS.
   *
   * @param dts The DTS to be converted.
   * @return The estimated frame index corresponding to the given DTS.
   */
  int64_t dts_to_frame_number(int64_t dts) const;

  /**
   * @brief Retrieves the duration of the video (in seconds).
   *
   * @return The total duration of the video file in seconds.
   */
  double getDurationSec() const;

  /**
   * @brief Converts a decoded frame to an RGBA-formatted AVFrame.
   *
   * @param frame The decoded frame (e.g., in YUV format) to be converted.
   * @return A pointer to the AVFrame in RGBA format, or nullptr on failure.
   */
  const AVFrame *ConvertFrameToRGBA(AVFrame *frame);

  /**
   * @brief Decodes and returns the next video frame from the file.
   *
   * If the decoder has a frame queued internally, it returns it immediately.
   * Otherwise, it reads packets until a valid frame is decoded. The function
   * also updates internal timestamps and adds the decoded frame to the
   * ring buffer for potential backward-seeking.
   *
   * @return A pointer to the newly decoded AVFrame, or nullptr on failure.
   */
  AVFrame *grabFrame();

public:
  /**
   * @brief Default constructor. Initializes internal pointers and state.
   */
  FFVideoReader();

  /**
   * @brief Destructor. Automatically closes the file and frees FFmpeg resources.
   */
  ~FFVideoReader();

  /**
   * @brief Opens a video file for reading and decoding.
   *
   * @param filename The path to the video file.
   * @return 0 on success, or -1 on failure (e.g., if file or stream can’t be opened).
   */
  int openFile(const std::string filename);

  /**
   * @brief Closes the currently open file, freeing any associated resources.
   */
  void closeFile(void);

  /**
   * @brief Retrieves the frames per second (FPS) of the opened video.
   *
   * This method attempts multiple strategies to find a reliable FPS:
   * checking r_frame_rate, using av_guess_frame_rate(), or falling back
   * to time_base if the other methods fail.
   *
   * @return The best-guess FPS value of the open video stream.
   */
  double getFps(void) const;

  /**
   * @brief Retrieves the total number of frames in the video, if known.
   *
   * If nb_frames in the stream is zero, it estimates the total frame count
   * by multiplying duration (in seconds) by FPS.
   *
   * @return The estimated or reported number of frames in the video.
   */
  int64_t getTotalFrames() const;

  /**
   * @brief Seeks to a specified frame number in the video.
   *
   * This method uses FFmpeg’s seeking capabilities to move to a keyframe
   * near the requested position, then decodes forward until the exact
   * frame is reached (unless @p closeTo is true, in which case it may
   * stop after the initial keyframe).
   *
   * @param frameNumber The target frame index to seek to.
   * @param closeTo If true, allows stopping at the nearest keyframe; otherwise,
   *                the function attempts to decode forward to the exact frame.
   * @return A pointer to the AVFrame at or near the requested frame number,
   *         or nullptr on failure.
   */
  AVFrame *seekToFrame(int64_t frameNumber, bool closeTo = false);

  /**
   * @brief Retrieves and converts a frame (by index) to RGBA format.
   *
   * After seeking to the specified frame, this method converts it from its
   * native pixel format to RGBA using ConvertFrameToRGBA(). If the seek
   * or conversion fails, it returns nullptr.
   *
   * @param frameNumber The target frame index to retrieve.
   * @param closeTo If true, may stop at the nearest keyframe rather than
   *                decoding forward. Otherwise, decodes to the exact frame.
   * @return A pointer to an RGBA-formatted AVFrame, or nullptr on failure.
   */
  const AVFrame *getRGBAFrame(int64_t frameNumber, bool closeTo = false);
};

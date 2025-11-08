#include "FFReader.hpp"

extern "C"
{
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/parseutils.h>
#include <libavutil/imgutils.h>
#include <libavutil/time.h>
}

#include <algorithm>
#include <iostream>

#if defined(__APPLE__)
#define AV_NOPTS_VALUE_ ((int64_t)0x8000000000000000LL)
#else
#define AV_NOPTS_VALUE_ ((int64_t)AV_NOPTS_VALUE)
#endif

#ifndef AVERROR_EOF
#define AVERROR_EOF (-MKTAG('E', 'O', 'F', ' '))
#endif

// This class heavily leveraged from
// https://github.com/opencv/opencv/blob/a8ec6586118c3f8e8f48549a85f2da7a5b78bcc9/modules/videoio/src/cap_ffmpeg_impl.hpp#L1473
// https://github.com/khomin/electron_ffmpeg_addon_camera/blob/master/src/video_source.cpp

constexpr static size_t max_read_attempts = 4096;
constexpr static size_t max_decode_attempts = 64;
constexpr static double eps_zero = 0.000025;

static double inline r2d(AVRational r)
{
  return r.num == 0 || r.den == 0 ? 0. : (double)r.num / (double)r.den;
}

FFVideoReader::FFVideoReader()
{
  formatContext = nullptr;
  codecContext = nullptr;
  swsContext = nullptr;
  packet = nullptr;
  frame = nullptr;
  rgbaFrame = nullptr;
  closeFile();
}

FFVideoReader::~FFVideoReader() { closeFile(); }

void FFVideoReader::closeFile(void)
{
  while (recentFrames.size())
  {
    auto oldest = recentFrames.front();
    av_frame_free(&oldest.second);
    recentFrames.pop_front();
  }

  picture_pts = AV_NOPTS_VALUE_;
  currentFrameNumber = -1;
  firstFrameNumber = -1;

  if (packet)
    av_packet_free(&packet);
  if (frame)
    av_frame_free(&frame);

  if (formatContext)
  {
    avformat_close_input(&formatContext);
    avformat_free_context(formatContext);
  }
  if (codecContext)
  {
    avcodec_close(codecContext);
    avcodec_free_context(&codecContext);
  }
  if (swsContext)
  {
    sws_freeContext(swsContext);
  }
  if (rgbaFrame)
  {
    av_frame_free(&rgbaFrame);
  }
  formatContext = nullptr;
  codecContext = nullptr;
  swsContext = nullptr;
  packet = nullptr;
  frame = nullptr;
  rgbaFrame = nullptr;

  picture_pts = AV_NOPTS_VALUE_;
  currentFrameNumber = -1;
  firstFrameNumber = -1;
}

/**
 * @brief Converts a given DTS (Decoding Timestamp) to seconds.
 *
 * This function subtracts the stream's start_time from the provided DTS
 * and multiplies it by the stream's time base in order to convert the
 * timestamp to a value in seconds.
 *
 * @param dts The Decoding Timestamp to be converted.
 * @return The time in seconds corresponding to the given DTS.
 */
double FFVideoReader::dts_to_sec(int64_t dts) const
{
  return (double)(dts - formatContext->streams[videoStreamIndex]->start_time) *
         r2d(formatContext->streams[videoStreamIndex]->time_base);
}

/**
 * @brief Converts a given DTS to a frame number based on the current FPS.
 *
 * This function first converts the DTS to seconds using dts_to_sec(),
 * then multiplies by getFps() to get the frame index. The 0.5 added before
 * casting ensures proper rounding to the nearest integer frame.
 *
 * @param dts The Decoding Timestamp to be converted.
 * @return The estimated frame number corresponding to the given DTS.
 */
int64_t FFVideoReader::dts_to_frame_number(int64_t dts) const
{
  double sec = dts_to_sec(dts);
  return (int64_t)(getFps() * sec + 0.5);
}

/**
 * @brief Retrieves the duration of the video in seconds.
 *
 * This function first attempts to get the duration from the
 * AVFormatContext. If that value is invalid or too small, it
 * falls back to the stream-specific duration multiplied by the
 * time base of the video stream.
 *
 * @return The total duration of the video in seconds.
 */
double FFVideoReader::getDurationSec() const
{
  double sec = (double)formatContext->duration / (double)AV_TIME_BASE;

  if (sec < eps_zero)
  {
    sec = (double)formatContext->streams[videoStreamIndex]->duration *
          r2d(formatContext->streams[videoStreamIndex]->time_base);
  }

  return sec;
}

/**
 * @brief Estimates or retrieves the total number of frames in the video.
 *
 * This function first checks nb_frames in the video stream. If nb_frames
 * is zero (which is common for certain codecs or container formats), the
 * method approximates total frames by multiplying getDurationSec() and
 * getFps().
 *
 * @return The estimated or reported total number of frames in the video.
 */
int64_t FFVideoReader::getTotalFrames() const
{
  int64_t nbf = formatContext->streams[videoStreamIndex]->nb_frames;

  if (nbf == 0)
  {
    nbf = (int64_t)floor(getDurationSec() * getFps() + 0.5);
  }
  return nbf;
}

/**
 * @brief Retrieves or estimates the video’s frames per second (FPS).
 *
 * This function attempts multiple ways to determine a reliable FPS:
 * 1. r_frame_rate from the video stream.
 * 2. av_guess_frame_rate() if r_frame_rate is invalid.
 * 3. The reciprocal of the stream's time_base if still invalid.
 *
 * @return The best-estimate FPS of the video.
 */
double FFVideoReader::getFps(void) const
{
  double fps = r2d(formatContext->streams[videoStreamIndex]->r_frame_rate);

  if (fps < eps_zero)
  {
    fps = r2d(av_guess_frame_rate(
        formatContext, formatContext->streams[videoStreamIndex], NULL));
  }

  if (fps < eps_zero)
  {
    fps = 1.0 / r2d(formatContext->streams[videoStreamIndex]->time_base);
  }

  return fps;
}

/**
 * @brief Opens a specified video file and prepares for decoding.
 *
 * This function allocates and initializes the necessary FFmpeg structures
 * (AVPacket, AVFrame, AVFormatContext, and AVCodecContext) for the provided file.
 * It attempts to locate and open a video stream, then discovers relevant
 * stream information (including codec parameters). Finally, it performs
 * an initial seek to frame 0 to prepare for subsequent frame decoding.
 *
 * @param filename The path to the video file to be opened.
 * @return 0 if successful, or -1 on error (e.g., unable to open the file,
 *         find stream information, locate a video stream, or properly
 *         decode the first frame).
 */
int FFVideoReader::openFile(const std::string filename)
{
  // av_log_set_level(AV_LOG_DEBUG);
  closeFile();
  first_utc_us = 0;
  packet = av_packet_alloc();
  frame = av_frame_alloc();
  formatContext = avformat_alloc_context();
  int ret =
      avformat_open_input(&formatContext, filename.c_str(), nullptr, nullptr);
  if (ret != 0)
  {
    avformat_free_context(formatContext);
    formatContext = nullptr;
    char err[160];
    av_strerror(ret, err, 160);
    std::cerr << "Error: Couldn't open video file " << filename << " " << err
              << std::endl;
    return -1;
  }

  if (avformat_find_stream_info(formatContext, nullptr) < 0)
  {
    std::cerr << "Error: Couldn't find stream information\n";
    return -1;
  }

  AVDictionaryEntry *e = av_dict_get(formatContext->metadata, "com.crewtimer.first_utc_us", nullptr, 0);
  if (e)
  {
    first_utc_us = std::stoull(e->value);
  }
  else
  {
    AVDictionaryEntry *creationEntry = av_dict_get(formatContext->metadata, "creation_time", nullptr, 0);
    if (creationEntry && creationEntry->value)
    {
      int64_t creation_us = 0;
      if (av_parse_time(&creation_us, creationEntry->value, 0) == 0 && creation_us > 0)
      {
        // av_parse_time returns microseconds relative to the Unix epoch.
        first_utc_us = static_cast<uint64_t>(creation_us);
        // std::cerr << "Parsed creation_time metadata: " << creationEntry->value << " -> " << first_utc_us << " us\n";
      }
    }
  }

  videoStreamIndex = -1;
  for (unsigned int i = 0; i < formatContext->nb_streams; i++)
  {
    if (formatContext->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_VIDEO)
    {
      videoStreamIndex = i;
      break;
    }
  }

  if (videoStreamIndex == -1)
  {
    std::cerr << "Error: Couldn't find a video stream\n";
    return -1;
  }

  AVCodecParameters *codecParameters =
      formatContext->streams[videoStreamIndex]->codecpar;
  const AVCodec *codec = avcodec_find_decoder(codecParameters->codec_id);
  codecContext = avcodec_alloc_context3(codec);
  avcodec_parameters_to_context(codecContext, codecParameters);
  avcodec_open2(codecContext, codec, nullptr);

  // std::cout << "Width: " << codecContext->width << std::endl;
  // std::cout << "Height: " << codecContext->height << std::endl;

  auto firstFrame = seekToFrame(0);

  return firstFrame ? 0 : -1;
}

/**
 * @brief Decodes and returns the next video frame from the open media file.
 *
 * This method first checks if there is already a decoded frame waiting in the codec's internal
 * buffer via avcodec_receive_frame(). If not, it reads packets from the format context until
 * a valid video frame is decoded.
 *
 * Once a valid frame is obtained, it updates the internal timestamp (picture_pts) to either
 * the packet's PTS or DTS (falling back to DTS if PTS is invalid). Using this timestamp, the
 * method computes the frame index with dts_to_frame_number() and stores it in currentFrameNumber.
 * On the very first decoded frame, firstFrameNumber is set as the zero-point for the frame index.
 *
 * In addition, this method deep-copies the newly decoded frame and adds it to a ring buffer
 * (recentFrames), which can hold up to 32 frames. This buffer allows short backward seeks
 * without needing to re-read or re-decode from an earlier keyframe.
 *
 * @note If no valid frame is found or decoding fails, the method returns @c nullptr.
 * @note The ring buffer logic is optional and is primarily used to facilitate short backward seeks.
 *
 * @return A pointer to the newly decoded AVFrame if successful, or @c nullptr if decoding fails.
 */
AVFrame *FFVideoReader::grabFrame()
{
  size_t cur_read_attempts = 0;
  size_t cur_decode_attempts = 0;

  // First, check if the decoder already has a frame in its buffer
  if (avcodec_receive_frame(codecContext, frame) != 0)
  {
    // Otherwise, read packets until we decode a valid frame
    picture_pts = AV_NOPTS_VALUE_;
    bool valid = false;
    while (!valid)
    {
      av_packet_unref(packet);

      int ret = av_read_frame(formatContext, packet);
      if (ret == AVERROR(EAGAIN))
        continue;

      if (ret == AVERROR_EOF)
      {
        // Flush cached frames from decoder
        packet->data = nullptr;
        packet->size = 0;
        packet->stream_index = videoStreamIndex;
      }

      if (packet->stream_index != videoStreamIndex)
      {
        // Not our video packet, ignore it
        av_packet_unref(packet);
        if (++cur_read_attempts > max_read_attempts)
        {
          std::cerr << "packet read max attempts exceeded\n";
          break;
        }
        continue;
      }

      // Send the packet to the decoder
      if (avcodec_send_packet(codecContext, packet) < 0)
      {
        // Error sending
        break;
      }

      // Now try to receive a decoded frame
      ret = avcodec_receive_frame(codecContext, frame);
      if (ret >= 0)
      {
        valid = true; // We got a frame
      }
      else if (ret == AVERROR(EAGAIN))
      {
        // Need more packets
        continue;
      }
      else
      {
        // Some other error
        if (++cur_decode_attempts > max_decode_attempts)
        {
          std::cerr << "frame decode max attempts exceeded\n";
          break;
        }
      }
    }

    // If we didn't get a valid frame, return null
    if (!valid)
    {
      currentFrameNumber = -1; // mark as stale
      return nullptr;
    }
  }

  // Compute the presentation timestamp if it's not yet set
  if (picture_pts == AV_NOPTS_VALUE_)
  {
    // If PTS is valid and nonzero, use that; otherwise, fall back on DTS
    picture_pts = (packet->pts != AV_NOPTS_VALUE_ && packet->pts != 0)
                      ? packet->pts
                      : packet->dts;
  }
  frame->pts = picture_pts;
  frame->time_base = formatContext->streams[videoStreamIndex]->time_base;

  // Calculate currentFrameNumber based on DTS

  // Set the anchor if this is our first valid frame
  if (firstFrameNumber < 0)
  {
    firstFrameNumber = dts_to_frame_number(picture_pts);
  }

  currentFrameNumber = dts_to_frame_number(picture_pts) - firstFrameNumber;

  // Deep-copy the newly decoded frame into our ring buffer
  AVFrame *copy = av_frame_alloc();
  av_frame_ref(copy, frame);
  recentFrames.emplace_back(currentFrameNumber, copy);

  // Keep the ring buffer at a maximum of 32 frames
  while (recentFrames.size() > 32)
  {
    auto oldest = recentFrames.front();
    av_frame_free(&oldest.second);
    recentFrames.pop_front();
  }

  // std::cout << "DEBUG: Grabbed frame =>\n"
  //           << "  packet->pts  = " << packet->pts << "\n"
  //           << "  packet->dts  = " << packet->dts << "\n"
  //           << "  picture_pts  = " << picture_pts << "\n"
  //           << "  frame->pts   = " << frame->pts << "\n"
  //           << "  currentFrameNumber = " << currentFrameNumber << "\n"
  //           << "  firstFrameNumber   = " << firstFrameNumber << "\n"
  //           << "  dts_to_frame_number(picture_pts) = "
  //           << dts_to_frame_number(picture_pts) << "\n"
  //           << "  maxFrames = " << getTotalFrames() << "\n";

  // if (formatContext && formatContext->streams[videoStreamIndex])
  // {
  //   std::cout << "  stream start_time   = "
  //             << formatContext->streams[videoStreamIndex]->start_time
  //             << "\n"
  //             << "  formatContext->start_time = "
  //             << formatContext->start_time << "\n"
  //             << std::endl;
  // }

  // Return the newly decoded frame
  return frame;
}

/**
 * @brief Seeks to a specific frame number in the video stream.
 *
 * This method attempts to position the reader at the specified frame number.
 * Due to the limitations of FFmpeg's seeking (which typically seeks to the nearest
 * preceding keyframe), the function uses a backoff strategy controlled by the `delta`
 * variable to seek slightly earlier than the desired frame and then decode forward
 * until the requested frame is reached.
 *
 * The method adaptively increases `delta` (the number of frames to seek backward)
 * if the initially guessed seek position is not close enough to decode to the
 * desired frame. This makes seeking more robust, especially for formats like H.264
 * that are not easily frame-seekable.
 *
 * @param frameNumber The target frame number to seek to.
 * @param closeTo If true, performs only the initial seek to a nearby keyframe
 *                and does not decode forward to the exact frame. Useful for fast
 *                scrubbing (e.g., scroll bar previews).
 * @return A pointer to the AVFrame at or near the desired frame number,
 *         or nullptr if seeking fails.
 *
 * @note The function may decode multiple frames in order to reach the exact frame.
 *       It also sets internal state such as `currentFrameNumber` and `picture_pts`.
 */
AVFrame *FFVideoReader::seekToFrame(int64_t frameNumber, bool closeTo)
{
  frameNumber = std::min(frameNumber, getTotalFrames() - 1);
  // if we have not grabbed a single frame before first seek, let's read the
  // first frame and get some valuable information during the process
  if (firstFrameNumber < 0 && getTotalFrames() > 1)
  {
    auto res = grabFrame();
    if (!res)
    {
      return nullptr;
    }
  }

  // Fast return: we’re already there
  if (frameNumber == currentFrameNumber)
  {
    return frame;
  }

  auto fps = getFps(); // needed below

  if (!closeTo)
  {

    // Check our ring buffer
    for (auto it = recentFrames.rbegin(); it != recentFrames.rend(); ++it)
    {
      if (it->first == frameNumber)
      {
        // Found it in buffer – set currentFrameNumber & copy the frame
        av_frame_ref(frame, it->second);
        currentFrameNumber = frameNumber;
        return frame;
      }
    }

    // If we're close to the correct position, seek forward frame by frame
    int64_t seekDelta = frameNumber - currentFrameNumber;
    if (seekDelta > 0 && seekDelta < 32)
    {
      while (currentFrameNumber < frameNumber)
      {
        if (!grabFrame())
        {
          break;
        }
      }
      if (currentFrameNumber == frameNumber)
      {
        return frame; // We found it!
      }
    }

    // --------------------------------------------------------------------------
    // Fast path: small *backward* jump (|seekDelta| < 32) not found in ring buffer
    // --------------------------------------------------------------------------
    if (seekDelta < 0 && -seekDelta < 32)
    {
      /* -------------------------------------------------------------
       * Strategy:
       *   1. Seek to the exact timestamp of the requested frameNumber
       *      using AVSEEK_FLAG_BACKWARD (never overshoots).
       *   2. Flush decoder.
       *   3. Decode forward with grabFrame() until we land on frameNumber.
       *      (= at most 31 calls, so still cheap).
       * ------------------------------------------------------------- */

      int64_t start_pts = formatContext->streams[videoStreamIndex]->start_time;
      double tb = r2d(formatContext->streams[videoStreamIndex]->time_base);
      double sec = static_cast<double>(frameNumber) / std::max(fps, 1e-6);
      int64_t ts = start_pts + static_cast<int64_t>(sec / tb + 0.5);

      if (av_seek_frame(formatContext, videoStreamIndex, ts, AVSEEK_FLAG_BACKWARD) < 0)
        return nullptr; // seek failed (corrupt file?)
      avcodec_flush_buffers(codecContext);

      if (!grabFrame()) // decode first frame after seek
        return nullptr;

      // We may still be a little before target; step forward a few frames
      while (currentFrameNumber < frameNumber)
        if (!grabFrame())
          return nullptr;

      /* At this point currentFrameNumber == frameNumber and frame points to it */
      return frame;
    }
  }
  //
  // Not found in ring buffer or seek from last position. Fall back to av_seek_frame search.
  //
  int delta = closeTo ? 0 : 16;
  for (;;)
  {
    int64_t _frame_number_temp = std::max(frameNumber - delta, (int64_t)0);
    double sec = (double)_frame_number_temp / fps;
    int64_t time_stamp = formatContext->streams[videoStreamIndex]->start_time;
    double time_base = r2d(formatContext->streams[videoStreamIndex]->time_base);
    time_stamp += (int64_t)(sec / time_base + 0.5);

    if (getTotalFrames() > 1)
    {
      if (av_seek_frame(formatContext, videoStreamIndex, time_stamp, AVSEEK_FLAG_BACKWARD) < 0)
      {
        return nullptr;
      }
    }
    avcodec_flush_buffers(codecContext);

    auto res = grabFrame();
    if (!res)
    {
      return nullptr;
    }

    // Don't decode forward — just stop here if 'closeTo' requested or the last grabFrame is where we want to go
    if (closeTo || (frameNumber == currentFrameNumber))
    {
      return frame;
    }

    if (currentFrameNumber < 0 || currentFrameNumber > frameNumber)
    {
      // Increase delta and try seeking again
      if (_frame_number_temp == 0 || delta >= INT_MAX / 4)
      {
        return nullptr;
      }
      delta = delta < 16 ? delta * 2 : delta * 3 / 2;
      continue;
    }

    // read forward until we reach the desired frame
    while (currentFrameNumber < frameNumber)
    {
      if (!grabFrame())
      {
        return nullptr;
      }
    }
    break;
  }
  return frame;
}

/**
 * @brief Converts a decoded frame to an RGBA-formatted AVFrame.
 *
 * This method uses an swsContext (created on demand) to convert the input
 * frame from its native format (e.g., YUV) into RGBA. If swsContext is not
 * yet initialized, it is allocated for the dimensions and pixel formats
 * of the current frame. The output frame (rgbaFrame) is also allocated
 * if necessary, ensuring it matches the dimensions of the source.
 *
 * @param frame A pointer to the decoded frame in its original format.
 * @return A pointer to the RGBA-formatted AVFrame, or @c nullptr if the
 *         conversion context or memory allocation fails.
 */
const AVFrame *FFVideoReader::ConvertFrameToRGBA(AVFrame *frame)
{
  // Create a context for the conversion if it doesn't exist
  if (!swsContext)
  {
    swsContext = sws_getContext(
        frame->width, frame->height, (AVPixelFormat)frame->format, // Source
        frame->width, frame->height, AV_PIX_FMT_RGBA,              // Destination
        SWS_BILINEAR, nullptr, nullptr, nullptr);
    if (!swsContext)
    {
      std::cerr << "Could not initialize the conversion context!" << std::endl;
      return nullptr;
    }
  }

  // Allocate memory for the output frame if needed
  if (!rgbaFrame || frame->width != rgbaFrame->width ||
      frame->height != rgbaFrame->height)
  {
    if (rgbaFrame)
    {
      av_frame_free(&rgbaFrame);
      rgbaFrame = nullptr;
    }
    rgbaFrame = av_frame_alloc();
    if (!rgbaFrame)
    {
      std::cerr << "Could not allocate memory for RGBA frame!" << std::endl;
      return nullptr;
    }
    rgbaFrame->format = AV_PIX_FMT_RGBA;
    rgbaFrame->width = frame->width;
    rgbaFrame->height = frame->height;

    // Allocate buffers for the RGBA data
    if (av_frame_get_buffer(rgbaFrame, 32) < 0)
    {
      std::cerr << "Could not allocate frame data!" << std::endl;
      av_frame_free(&rgbaFrame);
      rgbaFrame = nullptr;
      return nullptr;
    }
  }

  // Perform the conversion
  sws_scale(swsContext,
            frame->data, frame->linesize, 0, frame->height, // Source
            rgbaFrame->data, rgbaFrame->linesize            // Destination
  );

  rgbaFrame->pts = frame->pts;
  rgbaFrame->time_base = frame->time_base;
  return rgbaFrame;
}

/**
 * @brief Retrieves a frame at a specified index and converts it to RGBA format.
 *
 * First, this method attempts to seek to the given frame number (zero-based or one-based
 * depends on your usage). If @p closeTo is true, it may stop at a nearby keyframe. If the
 * seek succeeds, the resulting frame is passed to ConvertFrameToRGBA(). If the seek fails
 * or the frame index is out of bounds, the method returns @c nullptr.
 *
 * @param frameNumber The target frame index to retrieve - 1 to N.
 * @param closeTo A boolean indicating whether to stop at a nearby keyframe (true) or
 *                decode forward to the exact frame (false).
 * @return A pointer to an AVFrame in RGBA format, or @c nullptr if seeking or conversion fails.
 *
 * @note The frame numbering convention (whether 0-based or 1-based) depends on your codebase.
 *       This method checks if @p frameNumber is between 1 and getTotalFrames() by default.
 */
const AVFrame *FFVideoReader::getRGBAFrame(int64_t frameNumber, bool closeTo)
{
  // 1 to N based frameNumber
  if (frameNumber < 1 || frameNumber > getTotalFrames())
    return nullptr;

  // 0 to N-1 based frameNumber
  AVFrame *frame = seekToFrame(frameNumber - 1, closeTo);
  if (!frame)
  {
    return nullptr;
  }

  return ConvertFrameToRGBA(frame);
}

// ffmpeg -sseof -4 -i tmp-X22_00_55.mp4 -update 1 last.png

#ifdef FFREADER_TEST
#include <map>
#include <memory>

static std::map<std::string, std::unique_ptr<FFVideoReader>> videoReaders;

int main(int argc, char *argv[])
{
  if (argc < 2)
  {
    std::cerr << "Usage: " << argv[0] << " <filename>\n";
    return -1;
  }

  const char *filename = argv[1];

  if (videoReaders.count(filename))
  {
    std::cerr << "File already open\n";
    return -1;
  }
  std::unique_ptr<FFVideoReader> ffreader(new FFVideoReader());
  std::cout << "ffreader created" << std::endl;
  auto error = ffreader->openFile(filename);
  std::cout << "ffreader opened" << std::endl;

  auto reader = new FFVideoReader();

  if (reader->openFile(filename) < 0)
  {
    std::cerr << "Error: Couldn't open video file\n";
    return -1;
  }

  int64_t startTime = av_gettime_relative();

  AVFrame *frame = nullptr;
  int totalFrames = 0;
  do
  {
    frame = reader->seekToFrame(totalFrames);
    if (!frame)
    {
      std::cerr << "Error: Couldn't seek to frame " << totalFrames << std::endl;
      break;
    }
    totalFrames++;
  } while (totalFrames < 100);

  int64_t endTime = av_gettime_relative();
  double elapsedSeconds = (endTime - startTime) / 1000000.0;
  double framesPerSecond = totalFrames / elapsedSeconds;

  std::cout << "Processed " << totalFrames << " frames in " << elapsedSeconds
            << " seconds (" << framesPerSecond << " FPS)" << std::endl;

  reader->openFile(filename);
  reader->getRGBAFrame(10);

  for (int i = 1; i <= 1000; i++)
  {
    if (i % 100 == 0)
      std::cout << "iteration = " << i << std::endl;
    reader->openFile(filename);
    if (!reader->getRGBAFrame(10))
    {
      std::cout << "Error: Couldn't seek to frame " << i << std::endl;
      break;
    }
  }
  return 0;
}
#endif

#include "FFReader.hpp"

extern "C"
{
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
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

double FFVideoReader::dts_to_sec(int64_t dts) const
{
  return (double)(dts - formatContext->streams[videoStreamIndex]->start_time) *
         r2d(formatContext->streams[videoStreamIndex]->time_base);
}
int64_t FFVideoReader::dts_to_frame_number(int64_t dts) const
{
  double sec = dts_to_sec(dts);
  return (int64_t)(getFps() * sec + 0.5);
}

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

int64_t FFVideoReader::getTotalFrames() const
{
  int64_t nbf = formatContext->streams[videoStreamIndex]->nb_frames;

  if (nbf == 0)
  {
    nbf = (int64_t)floor(getDurationSec() * getFps() + 0.5);
  }
  return nbf;
}
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

int FFVideoReader::openFile(const std::string filename)
{
  // av_log_set_level(AV_LOG_DEBUG);
  closeFile();
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

AVFrame *FFVideoReader::grabFrame()
{
  size_t cur_read_attempts = 0;
  size_t cur_decode_attempts = 0;
  if (avcodec_receive_frame(codecContext, frame) == 0)
  {
    return frame;
  }
  picture_pts = AV_NOPTS_VALUE_;
  auto valid = false;
  while (!valid)
  {
    av_packet_unref(packet);

    auto ret = av_read_frame(formatContext, packet);
    if (ret == AVERROR(EAGAIN))
      continue;

    if (ret == AVERROR_EOF)
    {
      // flush cached frames from video decoder
      packet->data = NULL;
      packet->size = 0;
      packet->stream_index = videoStreamIndex;
    }
    if (packet->stream_index != videoStreamIndex)
    {
      av_packet_unref(packet);
      if (++cur_read_attempts > max_read_attempts)
      {
        std::cerr << "packet read max attempts exceeded, if your video have "
                     "multiple streams (video, audio) try to increase attempt "
                     "limit "
                     "(current value is "
                  << max_read_attempts << ")" << std::endl;
        break;
      }
      continue;
    }

    // Decode video frame
    if (avcodec_send_packet(codecContext, packet) < 0)
    {
      break;
    }
    ret = avcodec_receive_frame(codecContext, frame);

    if (ret >= 0)
    {
      valid = true;
    }
    else if (ret == AVERROR(EAGAIN))
    {
      continue;
    }
    else
    {
      if (++cur_decode_attempts > max_decode_attempts)
      {
        std::cerr << "frame decode max attempts exceeded, try to increase "
                     "attempt limit"
                     "(current value is "
                  << max_decode_attempts << ")" << std::endl;
        break;
      }
    }
  }

  if (valid)
  {
    if (picture_pts == AV_NOPTS_VALUE_)
    {

      picture_pts = packet->pts != AV_NOPTS_VALUE_ && packet->pts != 0
                        ? packet->pts
                        : packet->dts;
      currentFrameNumber++;
    }
  }

  if (valid && firstFrameNumber < 0)
    firstFrameNumber = dts_to_frame_number(picture_pts);

  // return if we have a new frame or not
  return valid ? frame : nullptr;
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
  frameNumber = std::min(frameNumber, getTotalFrames());
  if (frameNumber == currentFrameNumber)
  {
    return frame;
  }

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

  // If we're close to the correct position, seek forward frame by frame
  int64_t seekDelta = frameNumber - currentFrameNumber;
  if (seekDelta > 0 && seekDelta < 30)
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

  int delta = 16;
  auto fps = getFps();

  for (;;)
  {
    int64_t _frame_number_temp = std::max(frameNumber - delta, (int64_t)0);
    double sec = (double)_frame_number_temp / fps;
    int64_t time_stamp = formatContext->streams[videoStreamIndex]->start_time;
    double time_base = r2d(formatContext->streams[videoStreamIndex]->time_base);
    time_stamp += (int64_t)(sec / time_base + 0.5);

    if (getTotalFrames() > 1)
      av_seek_frame(formatContext, videoStreamIndex, time_stamp, AVSEEK_FLAG_BACKWARD);
    avcodec_flush_buffers(codecContext);

    if (frameNumber > 0)
    {
      auto res = grabFrame();
      if (!res)
      {
        return nullptr;
      }

      if (closeTo)
      {
        // Don't decode forward — just stop here
        currentFrameNumber = dts_to_frame_number(picture_pts) - firstFrameNumber;
        return frame;
      }

      if (frameNumber > 1)
      {
        currentFrameNumber = dts_to_frame_number(picture_pts) - firstFrameNumber;

        if (currentFrameNumber < 0 || currentFrameNumber > frameNumber - 1)
        {
          if (_frame_number_temp == 0 || delta >= INT_MAX / 4)
            break;
          delta = delta < 16 ? delta * 2 : delta * 3 / 2;
          continue;
        }

        while (currentFrameNumber < frameNumber - 1)
        {
          if (!grabFrame())
          {
            return nullptr;
          }
        }

        currentFrameNumber++;
        break;
      }
      else
      {
        currentFrameNumber = 1;
        break;
      }
    }
    else
    {
      currentFrameNumber = 0;
      break;
    }
  }

  return frame;
}

// Function to convert an AVFrame to RGBA
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

  // Allocate memory for the output frame
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
    // Set the fields of the frame
    (rgbaFrame)->format = AV_PIX_FMT_RGBA;
    (rgbaFrame)->width = frame->width;
    (rgbaFrame)->height = frame->height;

    // Allocate the buffers for the frame data
    if (av_frame_get_buffer(rgbaFrame, 32) < 0)
    {
      std::cerr << "Could not allocate frame data!" << std::endl;
      av_frame_free(&rgbaFrame);
      rgbaFrame = nullptr;
      return nullptr;
    }
  }

  // Perform the conversion
  sws_scale(swsContext, frame->data, frame->linesize, 0,
            frame->height,                           // Source
            (rgbaFrame)->data, (rgbaFrame)->linesize // Destination
  );

  return rgbaFrame;
}

const AVFrame *FFVideoReader::getRGBAFrame(int64_t frameNumber, bool closeTo)
{
  // std::cout << "getRGBAFrame: " << frameNumber << std::endl;
  if (frameNumber < 1 || frameNumber > getTotalFrames())
    return nullptr;

  auto frame = seekToFrame(frameNumber, closeTo);
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

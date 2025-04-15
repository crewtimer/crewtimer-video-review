#include <string>

extern "C"
{
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libswscale/swscale.h>
}

// This class heavily leveraged from
// https://github.com/opencv/opencv/blob/a8ec6586118c3f8e8f48549a85f2da7a5b78bcc9/modules/videoio/src/cap_ffmpeg_impl.hpp#L1473

class FFVideoReader
{
  AVFormatContext *formatContext;
  AVCodecContext *codecContext;
  SwsContext *swsContext;

  AVPacket *packet;
  AVFrame *frame;
  AVFrame *rgbaFrame;

  int videoStreamIndex;
  int64_t picture_pts;
  int64_t currentFrameNumber;
  int64_t firstFrameNumber;

  double dts_to_sec(int64_t dts) const;
  int64_t dts_to_frame_number(int64_t dts) const;
  double getDurationSec() const;
  const AVFrame *ConvertFrameToRGBA(AVFrame *frame);
  AVFrame *grabFrame();

public:
  FFVideoReader();
  ~FFVideoReader();

  int openFile(const std::string filename);
  void closeFile(void);
  double getFps(void) const;
  int64_t getTotalFrames() const;
  AVFrame *seekToFrame(int64_t frameNumber, bool closeTo = false);
  const AVFrame *getRGBAFrame(int64_t frameNumber, bool closeTo = false);
};

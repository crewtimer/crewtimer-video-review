# CrewTimer Video Review Internals

This document is a starting point for understanding the major internal data flows in the video review application. It focuses on the parts of the codebase that manage video discovery, sidecar metadata, timing history, interpolation, and persistence of interpolation context.

## High-level architecture

At a high level, the app splits into a few responsibilities:

- The renderer owns most video review state and UI.
- The main process exposes file, SQLite, and native video-reader services through preload bridges.
- Video files and their adjacent JSON files are treated as a portable review folder.
- Timing records are persisted locally in SQLite and also synchronized through the existing lap publish flow.

The main code areas discussed below are:

- `src/renderer/video/VideoFileUtils.tsx`
- `src/renderer/video/RequestVideoFrame.ts`
- `src/renderer/video/Sidecar.ts`
- `src/renderer/video/InterpolationStore.ts`
- `src/renderer/video/UseClickerData.ts`
- `src/main/lapstorage/LapStorage.ts`

## Video File System Monitoring

The video folder is monitored by the `FileMonitor` component in `src/renderer/video/VideoFileUtils.tsx`.

### What it does

- Reads the configured video directory from `useVideoDir()`.
- Polls the directory through `window.Util.getFilesInDirectory(...)`.
- Filters for supported video file types.
- Sorts video files by time extracted from the filename.
- Builds the in-memory `dirList` and `FileStatus` list used by the rest of the video UI.
- Selects an initial video file when none is active.

### Polling model

This is not OS-native filesystem watching. It is timer-based polling:

- Normal refresh interval: about 4 seconds.
- Faster refresh interval: about 500 ms when a split-video operation is pending.

This behavior is implemented in the `FileMonitor` `useEffect(...)` in `src/renderer/video/VideoFileUtils.tsx`.

### File status cache

Per-file metadata is cached in memory via `src/renderer/video/VideoFileStatus.tsx`:

- `fileStatusByNameCache` is a `Map<string, FileStatus>`.
- `useFileStatusList()` provides the list used by UI components.
- `getFileStatusByName()` is used throughout the seek and sidecar code.

The file status cache stores operational metadata such as:

- open/closed state
- frame counts
- start/end timestamps
- fps
- timezone offset
- loaded sidecar content

## JSON Sidecar Files

Each video file has a same-name `.json` sidecar stored beside it. These files are managed primarily in `src/renderer/video/VideoFileUtils.tsx` and `src/renderer/video/Sidecar.ts`.

### Purpose

The sidecar file stores video-local metadata that should travel with the video file itself. Examples include:

- file start/stop timestamps
- number of frames
- fps
- timezone offset
- finish line guide and lane guide settings

### Lifecycle

When a video directory is refreshed:

1. The app discovers video files.
2. It tries to load each file's sidecar with `loadVideoSidecar(...)`.
3. If the sidecar is missing, `createSidecarFile(...)` requests frame 1 from the native reader and builds a default sidecar.
4. The resulting sidecar is attached to the file's `FileStatus`.

When guide settings change:

- `saveVideoSidecar(...)` writes the updated guide configuration back to the video's `.json` sidecar.

### Design intent

Sidecars are video-scoped metadata. They are intended to remain adjacent to the video files so folders can be archived or copied as a coherent review package.

## Timestamp History

Timestamp history in this app comes from two related but different sources:

- local scored timestamps stored in SQLite
- lap/timestamp history received from Firebase

### Local timestamp persistence

Local lap storage is implemented in `src/main/lapstorage/LapStorage.ts`.

Important details:

- SQLite database name: `CrewTimer.db`
- table name: `TimeRecords`
- each lap is stored as JSON in the `Datum` column
- `uuid` is the SQLite primary key

`LapStorage.updateLap(...)` updates both:

- the in-memory lap list used by the renderer
- the backing SQLite row

The renderer-facing keyed view of scored entries is maintained in `src/renderer/util/LapStorageDatum.ts`.

That keyed store:

- maps entries by `${gate}_${event}_${bow}`
- feeds the timing sidebar and bow grid
- is the main lookup used when reopening a scored bow

### Firebase timestamp history

`src/renderer/video/UseClickerData.ts` transforms lap data from Firebase into a renderer-friendly `ExtendedLap[]`.

Key behaviors:

- sorts by server `Timestamp` so newer updates override older ones
- removes deleted items
- rebuilds the local keyed lap cache
- computes `seconds` from `Time` for display and seek convenience
- performs a final presentation sort by lap time

### How the UI uses this history

When reopening a bow:

- the app first checks the local scored entry cache
- if no local scored lap is found, it can fall back to Firebase-derived clicker data

This fallback logic is in `src/renderer/video/TimingSidebarUtil.ts`.

## Video Interpolation Details

Video interpolation is driven by the renderer state in `VideoSettings`, the request/seek logic in `RequestVideoFrame`, and the ROI helpers in `VideoUtils`.

### Core concepts

- `srcClickPoint`: where the user clicked in source-video coordinates
- `srcCenterPoint`: the current zoom center in source-video coordinates
- `zoomY`: the main zoom factor used for close review
- tracking region / ROI: the small region around the finish line used for close frame estimation

These values live in `src/renderer/video/VideoSettings.ts` as part of `VideoScaling`.

### How zoom/interpolation is initiated

User interaction in `src/renderer/video/Video.tsx` can:

- apply a manual zoom around the clicked rower position
- trigger auto-zoom seek behavior

`performAutoZoomSeek(...)` in `src/renderer/video/RequestVideoFrame.ts`:

1. stores the click point
2. asks for a frame near the current position with a zoom ROI
3. uses motion estimates from the native reader
4. estimates how many frames away the finish-line crossing is
5. seeks to that approximate destination frame
6. leaves the UI in a zoomed interpolation review state

### How the ROI is chosen

`getTrackingRegion(...)` in `src/renderer/video/VideoUtils.ts` computes a narrow rectangle:

- centered horizontally around the finish line
- vertically around the saved click point
- biased in the direction from which the boat is approaching

This keeps motion estimation focused on a small, relevant image subset instead of the full frame.

### Native reader integration

The renderer requests frames through `window.VideoUtils.getFrame(...)`, which ultimately goes through the native ffmpeg/opencv reader. The renderer can include:

- exact frame number
- timestamp seek target
- optional `zoom` rectangle
- blend/close-to flags used by interpolation workflows

The renderer-side request orchestration is in `src/renderer/video/RequestVideoFrame.ts`.

## Storage Of Video Interpolation Points

Interpolation context persistence is implemented in `src/renderer/video/InterpolationStore.ts`.

### Why a separate store exists

The scored lap model stores `EventNum`, `Bow`, and `Time`, but it does not natively store the interpolation click position that produced that time. Without extra persistence, reopening a time requires the user to reclick and rebuild the interpolation context.

### Store format

The app stores interpolation context in a folder-level file:

- filename: `interpolation.json`
- location: same folder as the video files

The store contains a map of records keyed by lap `uuid`.

Each record includes:

- lap identity
- gate / event / bow / time
- relative video filename
- `srcClickPoint`
- `srcCenterPoint`
- `trackingRegion`
- zoom state
- update timestamp

### Cache model

The interpolation store keeps a cache only for the active `storePath`.

Behavior:

- repeated reads in the same video folder use the in-memory copy
- changing video folders causes the next read to come from disk
- successful writes refresh the active cached store

### Write path

When a split is recorded in `src/renderer/video/AddSplitUtil.ts`:

1. the lap is stored through the normal lap flow
2. `saveInterpolationRecordForLap(...)` snapshots the current interpolation state
3. the store writes `interpolation.json` using a temp-file-and-rename pattern

### Read path

When a timed bow is reopened in `src/renderer/video/TimingSidebarUtil.ts`:

1. the lap is found from local scored data or clicker fallback data
2. `loadInterpolationRecordForLap(...)` checks for saved interpolation metadata
3. if found, `seekToTimestampWithInterpolation(...)` restores the saved view
4. if not found, the app performs a normal timestamp seek

### Separation from sidecars

This store is intentionally separate from the per-video sidecar `.json` files:

- sidecars are video-scoped metadata
- interpolation records are review-lap metadata spanning the folder/session

Keeping them separate avoids mixing video calibration data with per-result review state.

## Future Expansion

Useful follow-up sections for this document would be:

- seek and frame-request lifecycle
- Bow grid and timing sidebar interaction model
- native `ffreader` responsibilities
- lap publishing and synchronization
- guide editing and finish-line calibration

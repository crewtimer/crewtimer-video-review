import { UseDatum } from 'react-usedatum';
import { FileStatus } from './VideoTypes';

// const defaultFileStatus: FileStatus = {
//   open: false,
//   numFrames: 0,
//   filename: '',
//   startTime: 0,
//   endTime: 0,
//   duration: 0,
//   fps: 60,
//   tzOffset: -new Date().getTimezoneOffset(),
//   sidecar: {},
// };

const fileStatusByNameCache = new Map<string, FileStatus>();
export const [useFileStatusList, setFileStatusList, getFileStatusList] =
  UseDatum<FileStatus[]>([]);

export const updateFileStatus = (status: FileStatus) =>
  fileStatusByNameCache.set(status.filename, status);

export const getFileStatusByName = (name: string) =>
  fileStatusByNameCache.get(name);

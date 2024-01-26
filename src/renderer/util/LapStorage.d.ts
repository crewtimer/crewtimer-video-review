import { Lap } from 'crewtimer-common';

declare global {
  interface Window {
    LapStorage: {
      updateLapFields(fields: { uuid: string; [key: string]: string }): void;
      updateLap(datum: Lap): void;
      startLapStorage(): void;
      stopLapStorage(): void;
      truncateLapTable(): void;
    };
  }
}

export {};

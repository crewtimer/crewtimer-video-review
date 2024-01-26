declare global {
  interface Window {
    FinishLynx: {
      startLynxServer(): void;
      stopLynxServer(): void;
      generateEvtFiles(): void;
      chooseLynxFolder(): void;
      validateLynxFolder(folder: string): void;
    };
  }
}

export {};

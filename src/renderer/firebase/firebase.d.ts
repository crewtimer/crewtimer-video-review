declare global {
  interface Window {
    Firebase: {
      startFirebase(): void;
      stopFirebase(): void;
    };
  }
}

export {};

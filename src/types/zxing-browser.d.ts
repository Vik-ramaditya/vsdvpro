declare module '@zxing/browser' {
  export class BrowserMultiFormatReader {
    constructor(hints?: any, timeBetweenScansMillis?: number);
    decodeOnceFromVideoElement(videoElement: HTMLVideoElement): Promise<any>;
    reset(): void;
  }
}

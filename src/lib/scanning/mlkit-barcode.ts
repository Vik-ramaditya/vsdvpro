  /**
 * ML Kit (MediaPipe Tasks Vision) Barcode Scanner wrapper for Web.
 * - Lazily loads the WASM and model.
 * - Manages camera stream for a given video element.
 * - Provides start/stop lifecycle and debounces duplicate detections.
 *
 * Usage:
 *   const controls = await startMLKitBarcodeScanner(videoEl, (code) => { ... }, { deviceId })
 *   // later
 *   controls.stop()
 */

let visionModuleLoaded: Promise<any> | null = null;

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/barcode_scanner/barcode_scanner/float16/latest/barcode_scanner.task';

type StartOptions = {
  deviceId?: string | null;
  // Optional: custom constraints override
  constraints?: MediaStreamConstraints;
  // Optional region-of-interest (normalized 0..1) to restrict valid detections
  roi?: { left: number; top: number; right: number; bottom: number };
};

export type MLKitScannerControls = {
  stop: () => void;
};

async function loadVision() {
  if (!visionModuleLoaded) {
    visionModuleLoaded = (async () => {
      const vision = await import('@mediapipe/tasks-vision');
      // Some pre-release builds have incomplete surface (BarcodeScanner missing).
      const { FilesetResolver, BarcodeScanner } = vision as any;
      let filesetResolver: any = null;
      try {
        filesetResolver = await FilesetResolver.forVisionTasks(WASM_ROOT);
      } catch (e) {
        // If WASM fetch fails we still return to allow native fallback.
        // eslint-disable-next-line no-console
        console.warn('ML Kit: failed to init FilesetResolver, will attempt fallback', e);
      }
      return { FilesetResolver, BarcodeScanner, filesetResolver };
    })();
  }
  return visionModuleLoaded;
}

/**
 * Start ML Kit barcode scanning on a given video element.
 * Returns controls with a stop() method to shutdown scanning and camera.
 */
export async function startMLKitBarcodeScanner(
  videoEl: HTMLVideoElement,
  onCode: (text: string) => void,
  options: StartOptions = {}
): Promise<MLKitScannerControls> {
  if (typeof window === 'undefined') throw new Error('ML Kit: window not available');
  const nav: any = navigator as any;
  if (!nav?.mediaDevices?.getUserMedia) throw new Error('ML Kit: getUserMedia not available');

  // Choose constraints
  let constraints: MediaStreamConstraints;
  if (options.constraints) {
    constraints = options.constraints;
  } else {
    const common: any = options.deviceId
      ? { deviceId: { exact: options.deviceId } }
      : { facingMode: { ideal: 'environment' } };
    constraints = {
      video: {
        ...common,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      }
    } as MediaStreamConstraints;
  }

  // Request camera
  const stream = await nav.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
  // Some browsers require play() explicit
  await videoEl.play();

  // Load vision modules and model
  const { BarcodeScanner, filesetResolver } = await loadVision();

  let scanner: any = null;
  if (BarcodeScanner && filesetResolver) {
    try {
      scanner = await BarcodeScanner.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: MODEL_URL
        },
        runningMode: 'VIDEO'
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('ML Kit: BarcodeScanner.createFromOptions failed, will attempt fallback', e);
    }
  }

  // Fallback: use native BarcodeDetector API if available
  let useNativeDetector = false;
  let nativeDetector: any = null;
  let useZXing = false;
  let zxingReader: any = null;
  if (!scanner) {
    if (typeof (window as any).BarcodeDetector !== 'undefined') {
      try {
        nativeDetector = new (window as any).BarcodeDetector();
        useNativeDetector = true;
        // eslint-disable-next-line no-console
        console.info('ML Kit: using native BarcodeDetector fallback');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('ML Kit: native BarcodeDetector init failed', e);
      }
    }
  }

  if (!scanner && !useNativeDetector) {
    // Attempt ZXing fallback (pure JS) as last resort
    try {
      // @ts-ignore - package has no bundled types
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      zxingReader = new BrowserMultiFormatReader();
      useZXing = true;
      // eslint-disable-next-line no-console
      console.info('ML Kit: using ZXing fallback');
    } catch (e) {
      throw new Error('Barcode scanning not available: ML Kit and native BarcodeDetector missing; ZXing fallback failed to load.');
    }
  }

  let stopped = false;
  let lastText = '';
  let lastEmit = 0;

  const roi = options.roi;

  function withinROI(b: any): boolean {
    if (!roi) return true; // no restriction
    if (!b) return false;
    const vw = videoEl.videoWidth || 1;
    const vh = videoEl.videoHeight || 1;
    let xCenter: number | null = null;
    let yCenter: number | null = null;
    // Try common shapes
    const bb = (b.boundingBox || b.bounding_box || b.box || null);
    if (bb) {
      // Support MediaPipe style {originX, originY, width, height} or DOMRect style {x,y,width,height}
      const x = (bb.originX ?? bb.x ?? 0);
      const y = (bb.originY ?? bb.y ?? 0);
      const w = bb.width ?? 0;
      const h = bb.height ?? 0;
      xCenter = (x + w / 2) / vw;
      yCenter = (y + h / 2) / vh;
    } else if (Array.isArray(b.cornerPoints) && b.cornerPoints.length > 0) {
      // Average of corner points
      let sx = 0, sy = 0;
      b.cornerPoints.forEach((p: any) => { sx += p.x; sy += p.y; });
      xCenter = (sx / b.cornerPoints.length) / vw;
      yCenter = (sy / b.cornerPoints.length) / vh;
    }
    if (xCenter == null || yCenter == null) return false; // cannot verify -> reject
    return xCenter >= roi.left && xCenter <= roi.right && yCenter >= roi.top && yCenter <= roi.bottom;
  }

  const rafLoop = async () => {
    if (stopped) return;
    const ts = performance.now();
    try {
      let barcodes: any[] = [];
  if (scanner) {
        // detectForVideo returns results synchronously
        const result: any = scanner.detectForVideo(videoEl, ts);
        barcodes = result?.barcodes || [];
      } else if (useNativeDetector && nativeDetector) {
        // Native API requires imageBitmap
        // Create an offscreen canvas copy (cheap for small sizes)
        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          const bitmap = canvas; // canvas acts as source for detect
          try {
            barcodes = await nativeDetector.detect(bitmap as any);
          } catch {/* ignore */}
        }
      } else if (useZXing && zxingReader) {
        try {
          const result: any = await zxingReader.decodeOnceFromVideoElement(videoEl);
          if (result?.getText) {
            barcodes = [{ rawValue: result.getText() }];
          }
        } catch {/* ignore per frame */}
      }
      if (barcodes.length > 0) {
        // Filter by ROI if provided
        if (roi) {
          barcodes = barcodes.filter(withinROI);
        }
        const first: any = barcodes[0];
        const text: string = (first?.rawValue as string) || (first?.displayValue as string) || '';
        const now = Date.now();
        if (text && (text !== lastText || now - lastEmit > 500)) {
          lastText = text;
          lastEmit = now;
          onCode(text);
        }
      }
    } catch (e) {
      // Single frame errors are ignored but logged occasionally
      // eslint-disable-next-line no-console
      if (Math.random() < 0.01) console.debug('ML Kit frame error', e);
    }
    requestAnimationFrame(rafLoop);
  };

  requestAnimationFrame(rafLoop);

  const stop = () => {
    if (stopped) return;
    stopped = true;
  try { scanner?.close?.(); } catch {}
    try {
      const ms = videoEl.srcObject as MediaStream | null;
      ms?.getTracks()?.forEach((t) => t.stop());
    } catch {}
    try {
      videoEl.srcObject = null;
    } catch {}
  };

  return { stop };
}

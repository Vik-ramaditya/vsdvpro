import React, { useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

interface ZXingBarcodeScannerDemoProps {
  onResult: (code: string) => void;
}

const ZXingBarcodeScannerDemo: React.FC<ZXingBarcodeScannerDemoProps> = ({ onResult }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  const startScanner = async () => {
    setScanning(true);
    setError(null);
    try {
      if (!videoRef.current) throw new Error("Video element not ready");
      
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      
      // Start decoding from video element
      const result = await reader.decodeOnceFromVideoElement(videoRef.current);
      if (result) {
        onResult(result.getText());
        setScanning(false);
      }
    } catch (e: any) {
      setError(e.message || "Failed to start scanner");
      setScanning(false);
    }
  };

  const stopScanner = () => {
    try { 
      readerRef.current?.reset(); 
    } catch {}
    setScanning(false);
  };

  return (
    <div className="flex flex-col items-center">
      <video ref={videoRef} className="w-full max-w-md aspect-video border rounded" autoPlay muted playsInline />
      <div className="flex gap-2 mt-2">
        <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={startScanner} disabled={scanning}>
          {scanning ? "Scanning..." : "Start Scan"}
        </button>
        <button className="px-4 py-2 bg-gray-600 text-white rounded" onClick={stopScanner} disabled={!scanning}>
          Stop
        </button>
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="text-xs text-gray-500 mt-2">Camera access required. Point at barcode.</div>
    </div>
  );
};

export default ZXingBarcodeScannerDemo;

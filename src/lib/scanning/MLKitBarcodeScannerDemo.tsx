import React, { useEffect, useRef } from "react";

interface MLKitBarcodeScannerDemoProps {
  onResult: (code: string) => void;
}

const MLKitBarcodeScannerDemo: React.FC<MLKitBarcodeScannerDemoProps> = ({ onResult }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    let mounted = true;
    import("./mlkit-barcode").then(async (mod) => {
      if (!mounted || !videoRef.current) return;
      controlsRef.current = await mod.startMLKitBarcodeScanner(
        videoRef.current,
        (code: string) => {
          onResult(code);
          // Optionally stop after first result
          // controlsRef.current?.stop();
        },
        {}
      );
    });
    return () => {
      mounted = false;
      controlsRef.current?.stop();
    };
  }, [onResult]);

  return (
    <div className="flex flex-col items-center">
      <video ref={videoRef} className="w-full max-w-md aspect-video border rounded" autoPlay muted playsInline />
      <div className="text-xs text-gray-500 mt-2">Camera access required. Point at barcode.</div>
    </div>
  );
};

export default MLKitBarcodeScannerDemo;

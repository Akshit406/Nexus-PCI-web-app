import { useEffect, useRef, useState } from "react";

type SignaturePadProps = {
  onSave: (file: File) => void;
  onCancel: () => void;
};

export function SignaturePad({ onSave, onCancel }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Set proper context and white background (to avoid transparent issues on save)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0e1e3d"; // var(--ink-900)
  }, []);

  function getCoordinates(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function startDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    
    setIsDrawing(true);
    setIsEmpty(false);
    const { x, y } = getCoordinates(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endDrawing() {
    setIsDrawing(false);
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
  }

  function handleSave() {
    if (isEmpty || !canvasRef.current) return;
    
    canvasRef.current.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], "signature.png", { type: "image/png" });
        onSave(file);
      }
    });
  }

  return (
    <div className="signature-pad-container" style={{ display: "grid", gap: "12px" }}>
      <canvas
        ref={canvasRef}
        width={400}
        height={200}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={endDrawing}
        onPointerOut={endDrawing}
        style={{
          border: "1px solid var(--line-strong)",
          borderRadius: "var(--radius-md)",
          background: "#ffffff",
          touchAction: "none",
          cursor: "crosshair",
          maxWidth: "100%",
        }}
      />
      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
        <button type="button" className="ghost-button" onClick={handleClear} style={{ fontSize: "12px", padding: "6px 12px" }}>
          Limpiar
        </button>
        <button type="button" className="ghost-button" onClick={onCancel} style={{ fontSize: "12px", padding: "6px 12px" }}>
          Cancelar
        </button>
        <button type="button" className="primary-button" onClick={handleSave} disabled={isEmpty} style={{ fontSize: "12px", padding: "6px 12px" }}>
          Guardar Firma
        </button>
      </div>
    </div>
  );
}

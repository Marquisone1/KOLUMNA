import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** A QR code as crisp SVG squares, dark on a light card so phone cameras read it from the sofa */
export function QrCode({ text, size = 240, label }: { text: string; size?: number; label: string }) {
  const { path, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
    }
    return { path: d, n: count };
  }, [text]);
  const quiet = 3;
  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect x={-quiet} y={-quiet} width={n + quiet * 2} height={n + quiet * 2} fill="#fbf7ee" />
      <path d={path} fill="#161513" />
    </svg>
  );
}

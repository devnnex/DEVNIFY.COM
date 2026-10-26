import { useEffect, useState } from 'react';
export function useArtworkColor(src?: string) {
  const [color, setColor] = useState('#704285');
  useEffect(() => {
    let active = true;
    if (!src) {
      setColor('#704285');
      return;
    }
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 12;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, 12, 12);
        const data = context.getImageData(0, 0, 12, 12).data;
        let r = 0,
          g = 0,
          b = 0,
          total = 0;
        for (let i = 0; i < data.length; i += 4) {
          const weight = data[i + 3] / 255;
          r += data[i] * weight;
          g += data[i + 1] * weight;
          b += data[i + 2] * weight;
          total += weight;
        }
        if (active && total)
          setColor(
            '#' +
              [r, g, b]
                .map((v) =>
                  Math.round(v / total)
                    .toString(16)
                    .padStart(2, '0'),
                )
                .join(''),
          );
      } catch {
        if (active) setColor('#704285');
      }
    };
    image.src = src;
    return () => {
      active = false;
      image.onload = null;
    };
  }, [src]);
  return color;
}

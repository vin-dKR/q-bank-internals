import { type CSSProperties, type JSX, useRef, useState } from 'react';
import { type BoxRect, DraggableBox } from './draggable-box.js';

export type CanvasBox = BoxRect & {
  id: string;
  label: string;
  /** `ai` renders the box in the unconfirmed-suggestion style. Defaults to `manual`. */
  variant?: 'manual' | 'ai';
};
export type CanvasSize = {
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
};

type CropCanvasProps = {
  imageSrc: string;
  boxes: CanvasBox[];
  onUpdateBox: (id: string, rect: Partial<BoxRect>) => void;
  onDeleteBox: (id: string) => void;
  onSize: (size: CanvasSize) => void;
  /** Visual zoom factor for the page. 1 = fit width; >1 scrolls inside the frame. */
  zoom?: number;
};

/**
 * The left pane: the page image with draggable/resizable crop regions drawn over it. `zoom` scales the
 * frame visually with a CSS transform — the image's layout size (and therefore the box coordinate
 * space and the natural→display crop maths) is unchanged, so only the on-screen size grows. A sizer
 * wrapper reserves the scaled area so the surrounding container can scroll.
 */
export function CropCanvas({
  imageSrc,
  boxes,
  onUpdateBox,
  onDeleteBox,
  onSize,
  zoom = 1,
}: CropCanvasProps): JSX.Element {
  const imgRef = useRef<HTMLImageElement>(null);
  // The unscaled (zoom-1) display size of the page image. Transform-scaling doesn't change clientWidth,
  // so this stays valid across zoom levels — the box coordinate space and crop maths key off it.
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);

  const measure = (): void => {
    const el = imgRef.current;
    if (!el) return;
    setBaseSize({ width: el.clientWidth, height: el.clientHeight });
    onSize({
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
      displayWidth: el.clientWidth,
      displayHeight: el.clientHeight,
    });
  };

  // At >1x the frame keeps its base layout size and a CSS transform scales it up; a sizer wrapper
  // reserves the scaled footprint so the container scrolls instead of clipping.
  const zoomed = zoom !== 1 && baseSize !== null;
  const sizerStyle: CSSProperties | undefined = zoomed
    ? { width: baseSize.width * zoom, height: baseSize.height * zoom }
    : undefined;
  const frameStyle: CSSProperties = zoomed
    ? {
        width: baseSize.width,
        height: baseSize.height,
        transform: `scale(${String(zoom)})`,
        transformOrigin: 'top left',
      }
    : {};

  return (
    <div className="crop-canvas">
      <div className="crop-canvas__sizer" style={sizerStyle}>
        <div className="crop-canvas__frame" style={frameStyle}>
          <img
            ref={imgRef}
            src={imageSrc}
            alt="Source page"
            draggable={false}
            className="crop-canvas__img"
            onLoad={measure}
          />
          {boxes.map((box) => (
            <DraggableBox
              key={box.id}
              id={box.id}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              label={box.label}
              variant={box.variant ?? 'manual'}
              scale={zoom}
              onUpdate={onUpdateBox}
              onDelete={onDeleteBox}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

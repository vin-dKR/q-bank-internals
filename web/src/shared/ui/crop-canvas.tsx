import { type CSSProperties, type JSX, useEffect, useRef, useState } from 'react';
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
};

/**
 * The left pane: the page image with draggable/resizable crop regions drawn over it. The whole page is
 * fit inside the available frame (`scale = min(frameW/pageW, frameH/pageH)`, contain-fit) so it is
 * always fully visible — no scrolling, no zoom — matching the school-test viewer. The frame is sized to
 * the fitted pixels and the image fills it, so the box coordinate space is exactly those display pixels
 * and the display↔natural crop maths key off it. A ResizeObserver re-fits when the column resizes.
 */
export function CropCanvas({
  imageSrc,
  boxes,
  onUpdateBox,
  onDeleteBox,
  onSize,
}: CropCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const update = (): void => { setFrame({ width: el.clientWidth, height: el.clientHeight }); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, []);

  const onLoad = (): void => {
    const el = imgRef.current;
    if (el) setNatural({ width: el.naturalWidth, height: el.naturalHeight });
  };

  // Contain-fit: the largest uniform scale that keeps the whole page inside the frame.
  const scale =
    natural && frame.width > 0 && frame.height > 0 && natural.width > 0 && natural.height > 0
      ? Math.min(frame.width / natural.width, frame.height / natural.height)
      : null;
  const displayWidth = natural && scale ? natural.width * scale : 0;
  const displayHeight = natural && scale ? natural.height * scale : 0;

  // Publish the fitted size so the workspace can map display pixels ↔ natural pixels for cropping.
  useEffect(() => {
    if (natural && displayWidth > 0 && displayHeight > 0) {
      onSize({
        naturalWidth: natural.width,
        naturalHeight: natural.height,
        displayWidth,
        displayHeight,
      });
    }
  }, [natural, displayWidth, displayHeight, onSize]);

  const frameStyle: CSSProperties =
    displayWidth > 0 && displayHeight > 0 ? { width: displayWidth, height: displayHeight } : {};

  return (
    <div ref={containerRef} className="crop-canvas">
      <div className="crop-canvas__frame" style={frameStyle}>
        <img
          ref={imgRef}
          src={imageSrc}
          alt="Source page"
          draggable={false}
          className="crop-canvas__img"
          onLoad={onLoad}
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
            scale={1}
            onUpdate={onUpdateBox}
            onDelete={onDeleteBox}
          />
        ))}
      </div>
    </div>
  );
}

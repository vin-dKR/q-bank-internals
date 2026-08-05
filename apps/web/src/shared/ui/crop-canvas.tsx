import { type JSX, useRef } from 'react';
import { type BoxRect, DraggableBox } from './draggable-box.js';

export type CanvasBox = BoxRect & { id: string; label: string };
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

/** The left pane: the page image with draggable/resizable crop regions drawn over it. */
export function CropCanvas({
  imageSrc,
  boxes,
  onUpdateBox,
  onDeleteBox,
  onSize,
}: CropCanvasProps): JSX.Element {
  const imgRef = useRef<HTMLImageElement>(null);

  const measure = (): void => {
    const el = imgRef.current;
    if (!el) return;
    onSize({
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
      displayWidth: el.clientWidth,
      displayHeight: el.clientHeight,
    });
  };

  return (
    <div className="crop-canvas">
      <div className="crop-canvas__frame">
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
            onUpdate={onUpdateBox}
            onDelete={onDeleteBox}
          />
        ))}
      </div>
    </div>
  );
}

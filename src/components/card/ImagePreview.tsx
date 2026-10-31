import type { Clip } from "../../types";
import { convertFileSrc } from "../../lib/api";

export function ImagePreview({ clip }: { clip: Clip }) {
  if (!clip.imagePath) return <div className="preview plain">Image unavailable</div>;
  return (
    <div className="preview image">
      <img src={convertFileSrc(clip.imagePath)} alt="clipboard image" draggable={false} />
    </div>
  );
}

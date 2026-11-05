import type { Clip } from "../../types";
import { ClipboardImage } from "./ClipboardImage";

export function ImagePreview({ clip }: { clip: Clip }) {
  if (!clip.imagePath) return <div className="preview plain">Image unavailable</div>;
  return (
    <div className="preview image">
      <ClipboardImage path={clip.imagePath} />
    </div>
  );
}

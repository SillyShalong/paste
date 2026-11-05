import { useEffect, useState } from "react";
import { api, convertFileSrc } from "../../lib/api";

/** Load the app's cached screenshot, with an IPC fallback if asset URLs fail. */
export function ClipboardImage({ path }: { path: string }) {
  const [fallback, setFallback] = useState<{ path: string; url: string | null } | null>(null);

  useEffect(() => {
    setFallback(null);
  }, [path]);

  const usingFallback = fallback?.path === path;
  if (usingFallback && !fallback.url) return <span>Image unavailable</span>;

  return (
    <img
      src={usingFallback ? fallback.url! : convertFileSrc(path)}
      alt="clipboard image"
      draggable={false}
      onError={() => {
        if (usingFallback) {
          setFallback({ path, url: null });
          return;
        }
        api.readFileImage(path)
          .then((url) => setFallback({ path, url }))
          .catch(() => setFallback({ path, url: null }));
      }}
    />
  );
}

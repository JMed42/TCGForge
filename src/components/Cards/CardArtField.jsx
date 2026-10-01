import React, { useEffect, useState } from 'react';
import { ImagePlus, X, ImageOff } from 'lucide-react';

// Card art picker: the chosen image is copied into the project's art folder by the main
// process; the card stores the project-relative path in image_path.
export default function CardArtField({ projectId, value, onChange }) {
  const [thumb, setThumb] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setThumb(null);
    if (!value || !projectId) return undefined;
    window.api?.getImageThumbnail?.(projectId, value)
      .then((t) => { if (!cancelled) setThumb(t); })
      .catch(() => { if (!cancelled) setThumb(null); });
    return () => { cancelled = true; };
  }, [projectId, value]);

  const choose = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await window.api.chooseCardArt(projectId);
      if (!res?.canceled) {
        setThumb(res.thumbnail);
        onChange(res.path);
      }
    } catch (err) {
      setError(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-4 items-start">
      <div
        data-testid="card-art-thumb"
        className="w-28 h-28 flex-none rounded border border-border bg-surface-2 flex items-center justify-center overflow-hidden"
      >
        {thumb ? (
          <img src={thumb.dataUrl} alt="Card art" className="max-w-full max-h-full object-contain" />
        ) : value ? (
          <ImageOff size={24} className="text-text-muted" title="Image file not found" />
        ) : (
          <span className="text-xs text-text-muted">No art</span>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={choose}
            disabled={busy || !projectId}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 disabled:opacity-40 rounded text-sm text-text-primary"
          >
            <ImagePlus size={16} />
            {value ? 'Replace…' : 'Choose…'}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="flex items-center gap-1 px-2 py-1.5 bg-surface-2 hover:bg-surface-3 rounded text-sm text-text-secondary hover:text-danger"
            >
              <X size={14} /> Clear
            </button>
          )}
        </div>
        {value && <p className="text-xs text-text-muted font-mono truncate" title={value}>{value}</p>}
        {thumb && <p className="text-xs text-text-muted">{thumb.width} × {thumb.height} px</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
        <p className="text-xs text-text-muted">PNG, JPG or GIF. The file is copied into the project, so the original can be moved.</p>
      </div>
    </div>
  );
}

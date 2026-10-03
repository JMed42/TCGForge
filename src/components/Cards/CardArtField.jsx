import React, { useEffect, useState } from 'react';
import { ClipboardPaste, ImagePlus, X, ImageOff } from 'lucide-react';

const ipcMessage = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// An image field (card art or a custom image field). The image is copied into the project's
// assets/art folder and the card stores the project-relative path. Three ways in: Choose…
// (file dialog), Paste (an image or image file on the clipboard), or drop a file on it.
export default function CardArtField({ projectId, value, onChange, name }) {
  const [thumb, setThumb] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setThumb(null);
    if (!value || !projectId) return undefined;
    window.api?.getImageThumbnail?.(projectId, value)
      .then((t) => { if (!cancelled) setThumb(t); })
      .catch(() => { if (!cancelled) setThumb(null); });
    return () => { cancelled = true; };
  }, [projectId, value]);

  const run = async (fn) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fn();
      if (res?.empty) setError('No image on the clipboard. Copy an image (or an image file in Explorer) first.');
      else if (res && !res.canceled) {
        setThumb(res.thumbnail);
        onChange(res.path);
      }
    } catch (err) {
      setError(ipcMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const choose = () => run(() => window.api.chooseCardArt(projectId));
  const paste = () => run(() => window.api.pasteImageFromClipboard(projectId, { folder: 'art', name }));
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    let p = null;
    try { p = window.api.pathForFile(file); } catch { p = null; }
    if (!p) { setError('Could not read that file.'); return; }
    run(() => window.api.importCardArt(projectId, p));
  };

  return (
    <div
      className={`flex gap-4 items-start rounded-lg p-1 -m-1 ${over ? 'ring-2 ring-accent' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      data-testid="art-field"
    >
      <div
        data-testid="card-art-thumb"
        className="w-28 h-28 flex-none rounded border border-border bg-surface-2 flex items-center justify-center overflow-hidden"
      >
        {thumb ? (
          <img src={thumb.dataUrl} alt="Card art" className="max-w-full max-h-full object-contain" />
        ) : value ? (
          <ImageOff size={24} className="text-text-muted" title="Image file not found" />
        ) : (
          <span className="text-xs text-text-muted text-center px-2">No image<br />drop a file here</span>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={choose} disabled={busy || !projectId} className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 disabled:opacity-40 rounded text-sm text-text-primary">
            <ImagePlus size={16} />
            {value ? 'Replace…' : 'Choose…'}
          </button>
          <button type="button" onClick={paste} disabled={busy || !projectId} data-testid="paste-art" title="Paste an image you copied (Ctrl+C in a browser, image editor or Explorer)" className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 disabled:opacity-40 rounded text-sm text-text-primary">
            <ClipboardPaste size={16} />
            Paste
          </button>
          {value && (
            <button type="button" onClick={() => onChange('')} className="flex items-center gap-1 px-2 py-1.5 bg-surface-2 hover:bg-surface-3 rounded text-sm text-text-secondary hover:text-danger">
              <X size={14} /> Clear
            </button>
          )}
        </div>
        {value && <p className="text-xs text-text-muted font-mono truncate" title={value}>{value}</p>}
        {thumb && <p className="text-xs text-text-muted">{thumb.width} × {thumb.height} px</p>}
        {error && <p className="text-xs text-danger" data-testid="art-error">{error}</p>}
        <p className="text-xs text-text-muted">PNG, JPG or GIF. The file is copied into the project, so the original can be moved.</p>
      </div>
    </div>
  );
}

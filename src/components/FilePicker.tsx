import { useId, useState } from 'react';
import { Camera, ImagePlus, Upload, Check, X, LoaderCircle } from 'lucide-react';

interface Props {
  label: string;
  preview?: string;
  shape?: 'avatar' | 'cover';
  onSelect: (file: File) => Promise<void>;
  onClear?: () => void | Promise<void>;
}

export function FilePicker({ label, preview, shape = 'avatar', onSelect, onClear }: Props) {
  const id = useId();
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const Icon = shape === 'avatar' ? Camera : ImagePlus;
  return (
    <div className={`field premium-file-field picker-${shape}`}>
      <span>{label}</span>
      <div
        className={`premium-file-picker ${preview ? 'has-preview' : ''} ${busy ? 'is-busy' : ''}`}
      >
        <input
          id={id}
          className="accessible-file-input"
          type="file"
          aria-label={label}
          accept="image/*"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setBusy(true);
            setError('');
            try {
              await onSelect(file);
              setFilename(file.name);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'No se pudo cargar la imagen.');
            } finally {
              setBusy(false);
            }
          }}
        />
        <label htmlFor={id} className="premium-file-target">
          <span className="file-preview">
            {preview ? <img src={preview} alt="Vista previa de la imagen" /> : <Icon size={23} />}
            <span className="file-preview-badge">
              {preview ? <Check size={10} /> : <PlusMark />}
            </span>
          </span>
          <span className="file-picker-copy">
            <strong>
              {busy
                ? 'Preparando tu imagen…'
                : preview
                  ? 'Tu imagen, tu identidad'
                  : shape === 'avatar'
                    ? 'Dale tu toque personal'
                    : 'Ponle imagen al momento'}
            </strong>
            <small>
              {filename ||
                (preview ? 'Lista para acompañar tu música' : 'JPG, PNG o WebP · Hasta 20 MB')}
            </small>
          </span>
          <span className="file-picker-cta">
            {busy ? <LoaderCircle className="spin" size={15} /> : <Upload size={14} />}
            <span>{preview ? 'Cambiar' : 'Elegir'}</span>
          </span>
        </label>
        {!!preview && onClear && (
          <button
            type="button"
            className="file-clear"
            disabled={busy}
            aria-label={`Quitar imagen: ${label}`}
            onClick={async () => {
              await onClear();
              setFilename('');
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {error && (
        <small className="file-picker-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
function PlusMark() {
  return <span aria-hidden="true">+</span>;
}

import { useId, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Cadre pointillé : clic ou glisser-déposer de fichiers .jar (plusieurs acceptés, envoyés l'un après l'autre). */
export function UploadDropzone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const [over, setOver] = useState(false);
  const accept = (list: FileList | null) => { const files = Array.from(list ?? []).filter((f) => f.name.toLowerCase().endsWith('.jar')); if (files.length) onFiles(files); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (!disabled) accept(e.dataTransfer.files); };
  return (
    <label htmlFor={id} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
      className={cn('flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground transition-colors', over ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40', disabled && 'pointer-events-none opacity-60')}>
      <Upload className="h-4 w-4" />
      <span>{t('mods.upload.drop')}</span>
      <input id={id} type="file" accept=".jar" multiple className="sr-only" disabled={disabled} onChange={(e) => { accept(e.target.files); e.target.value = ''; }} />
    </label>
  );
}

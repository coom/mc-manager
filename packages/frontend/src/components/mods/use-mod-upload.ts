import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MAX_UPLOAD_BYTES, type ModsView } from '@mc/common';
import { modsApi } from '@/api/mods.api';
import { describeModsError, type ApiError } from './mods-errors';

export interface UploadState { file: File; progress: number }

/** File d'envoi séquentielle : un fichier à la fois, progression, annulation, propositions de remplacement traitées une par une. */
export function useModUpload(onDone: (view: ModsView) => void) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<UploadState | null>(null);
  const [pendingReplace, setPendingReplace] = useState<File[]>([]);
  const queue = useRef<{ file: File; replace: boolean }[]>([]);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const run = async () => {
    const next = queue.current.shift();
    if (!next) { running.current = false; setCurrent(null); return; }
    running.current = true;
    controller.current = new AbortController();
    setCurrent({ file: next.file, progress: 0 });
    try {
      const view = await modsApi.upload(next.file, { replace: next.replace, signal: controller.current.signal, onProgress: (p) => setCurrent({ file: next.file, progress: p }) });
      onDone(view);
      toast.success(t('mods.upload.done'));
    } catch (err) {
      const e = err as ApiError & { code?: string; response?: { status?: number } };
      const code = e.response?.data?.code;
      if (e.code === 'ERR_CANCELED') { /* annulé par l'utilisateur */ }
      else if (!next.replace && code === 'exists') setPendingReplace((q) => [...q, next.file]);
      // nginx refuse lui-même un corps > 100 Mo avec un 413 sans code : on le traduit quand même.
      else if (e.response?.status === 413 && !code) toast.error(t('mods.errors.too_large'));
      else toast.error(describeModsError(e, t));
    }
    void run();
  };
  const start = (file: File, replace = false) => {
    if (file.size > MAX_UPLOAD_BYTES) { toast.error(t('mods.errors.too_large')); return; }
    queue.current.push({ file, replace });
    if (!running.current) void run();
  };
  const cancel = () => controller.current?.abort();
  const confirmReplace = () => { const [f, ...rest] = pendingReplace; setPendingReplace(rest); if (f) start(f, true); };
  const dismissReplace = () => setPendingReplace((q) => q.slice(1));
  return { current, start, cancel, pendingReplace: pendingReplace[0] ?? null, confirmReplace, dismissReplace };
}

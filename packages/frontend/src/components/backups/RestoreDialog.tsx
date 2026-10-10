import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BackupEntry, RestoreRequest } from '@mc/common';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface Props { entry: BackupEntry | null; open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (req: RestoreRequest) => void; loading: boolean; serverStopped: boolean }

/** Confirmation de restauration : options, et double confirmation « sans filet » si le serveur est arrêté. */
export function RestoreDialog({ entry, open, onOpenChange, onConfirm, loading, serverStopped }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && entry && <Body entry={entry} loading={loading} serverStopped={serverStopped} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} />}</DialogContent>
    </Dialog>
  );
}

function Body({ entry, loading, serverStopped, onCancel, onConfirm }: { entry: BackupEntry; loading: boolean; serverStopped: boolean; onCancel: () => void; onConfirm: (r: RestoreRequest) => void }) {
  const { t, i18n } = useTranslation();
  const [startAfter, setStartAfter] = useState(true);
  const [noSafety, setNoSafety] = useState(false);
  const canConfirm = !loading && (!serverStopped || noSafety);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('backups.confirmRestore.title', { name: entry.name })}</DialogTitle>
        <DialogDescription>{new Date(entry.modifiedAt).toLocaleString(i18n.language)} — {t('backups.confirmRestore.description')}</DialogDescription>
      </DialogHeader>
      {serverStopped && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">{t('backups.confirmRestore.noSafety')}</p>}
      <div className="space-y-2">
        <div className="flex items-center gap-2"><Checkbox id="restore-start-after" checked={startAfter} onCheckedChange={(v) => setStartAfter(v === true)} /><Label htmlFor="restore-start-after">{t('backups.confirmRestore.startAfter')}</Label></div>
        {serverStopped && <div className="flex items-center gap-2"><Checkbox id="restore-no-safety" checked={noSafety} onCheckedChange={(v) => setNoSafety(v === true)} /><Label htmlFor="restore-no-safety">{t('backups.confirmRestore.confirmNoSafety')}</Label></div>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={loading}>{t('shared.cancel')}</Button>
        <Button variant="destructive" disabled={!canConfirm} onClick={() => onConfirm({ startAfter, confirmNoSafetyBackup: serverStopped && noSafety })}>{loading ? t('shared.processing') : t('backups.confirmRestore.confirm')}</Button>
      </DialogFooter>
    </>
  );
}

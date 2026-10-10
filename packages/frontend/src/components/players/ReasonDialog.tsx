import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props { open: boolean; onOpenChange: (o: boolean) => void; title: string; withReason?: boolean; destructive?: boolean; loading?: boolean; onConfirm: (reason?: string) => void }

/** Confirmation d'une action joueur, avec champ raison optionnel (kick, ban, ban IP). */
export function ReasonDialog({ open, onOpenChange, title, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{title}</DialogDescription></DialogHeader>
        <ReasonBody onCancel={() => onOpenChange(false)} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

/** Le contenu n'est monté que tant que le dialogue est ouvert : toute fermeture (Annuler, Échap, succès, erreur) efface la raison saisie. */
function ReasonBody({ withReason, destructive, loading, onConfirm, onCancel }: Pick<Props, 'withReason' | 'destructive' | 'loading' | 'onConfirm'> & { onCancel: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <>
      {withReason && (
        <div className="space-y-1.5">
          <Label htmlFor="player-action-reason">{t('players.reason')}</Label>
          <Input id="player-action-reason" value={reason} maxLength={100} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={loading}>{t('shared.cancel')}</Button>
        <Button variant={destructive ? 'destructive' : 'default'} disabled={loading} onClick={() => onConfirm(reason.trim() || undefined)}>{loading ? t('shared.processing') : t('shared.confirm')}</Button>
      </DialogFooter>
    </>
  );
}

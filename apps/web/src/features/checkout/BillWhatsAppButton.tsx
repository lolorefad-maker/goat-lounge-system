import { useQuery } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { Button, buttonClass } from '../../components/ui/button';
import { useT } from '../../i18n';
import { get } from '../../lib/api';
import { useFmt } from '../../lib/format';
import { useBranch } from '../../lib/queries';
import type { Bill } from '../../lib/types';
import { billWhatsappUrl } from './billWhatsapp';

/**
 * After a checkout of a device with a phone number: opens WhatsApp on that number with the bill
 * written out; the cashier only presses send. Nothing is sent by the system.
 */
export function BillWhatsAppButton({ billId, phone, block }: { billId: string; phone: string; block?: boolean }) {
  const { t } = useT();
  const f = useFmt();
  const branch = useBranch();
  const bill = useQuery({ queryKey: ['bill', billId], queryFn: () => get<Bill>(`/api/bills/${billId}`) });

  if (!bill.data || !branch) {
    return (
      <Button variant="success" size="lg" block={block} loading={bill.isPending} disabled>
        {t('billWa.preparing')}
      </Button>
    );
  }
  return (
    <a
      href={billWhatsappUrl(phone, bill.data, { shop: branch.name, f })}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClass({ variant: 'success', size: 'lg', block, className: 'gap-2' })}
    >
      <MessageCircle className="size-5" aria-hidden />
      {t('billWa.send')}
    </a>
  );
}

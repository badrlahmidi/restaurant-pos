import React from "react";
import {Textarea} from "@/components/common/input/textarea.tsx";
import {useTranslation} from "react-i18next";

interface Props {
  notes?: string
  setNotes: (notes?: string) => void
}

export const OrderPaymentNotes = ({
  notes, setNotes
}: Props) => {
  const {t} = useTranslation('payment');

  return (
    <div className="flex flex-col h-full" data-testid="payment-panel-notes">
      <h5 className="text-3xl">{t('notes.title')}</h5>
      <p className="text-neutral-500">{t('notes.hint')}</p>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
        enableKeyboard
        rows={5}
      />
    </div>
  );
}

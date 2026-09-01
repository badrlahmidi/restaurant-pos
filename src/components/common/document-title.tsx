import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Sets `document.title` while mounted. Replaces react-helmet (unmaintained,
 * no React 18 support) — this component only ever set the page title.
 */
export function DocumentTitle({ parts }: { parts: Array<string | null | undefined> }) {
  const { t } = useTranslation('common');
  const title = [...parts.filter(Boolean), t('documentTitle.app')].join(' | ');

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}

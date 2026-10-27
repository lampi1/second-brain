// Streaming text subscribes independently of the tile header and composer. Only on-screen transcripts render chunks;
// offscreen lists stay mounted with their last snapshot, so reading position and drafts survive workspace scrolling.
import { memo, useEffect, useRef, useState } from 'react';
import type { ChatItem } from '@shared/contract';
import {t} from '../i18n';
import { visibleSnapshot } from '../lib/visible-snapshot';
import { useApp } from '../store/store';
import { ItemList, turnActivity, Typing } from './ChatItems';

const EMPTY: readonly ChatItem[] = [];
export const ChatTranscript = memo(function ChatTranscript({ chatId, busy, expanded }: { chatId: string; busy: boolean; expanded: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // First paint must not depend on an observer callback (hidden/restored windows may deliver it late).
  const [visible, setVisible] = useState(true);
  const snapshot = useRef(visibleSnapshot<readonly ChatItem[] | undefined>(undefined));
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setVisible(entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0);
    });
    // The tile's geometry is independent of loaded text/skeletons; observing content can create a zero-size cycle.
    observer.observe(el.closest('.chat-tile') ?? el);
    return () => observer.disconnect();
  }, []);
  const active = visible && expanded;
  const items = useApp(s => snapshot.current(s.items[chatId], active));
  return <div ref={ref} className="chat-transcript" data-transcript-visible={active ? 'true' : 'false'}>
    {items === undefined ? <div className="items-wrap"><div className={`items skeleton${active ? '' : ' still'}`} aria-label={t('product.transcriptLoading')}><i /><i /><i className="short" /></div></div> :
      <ItemList chatId={chatId} items={items ?? EMPTY} empty={t('product.transcriptEmpty')}
        footer={busy ? <Typing what={turnActivity(items)} testid={`typing-${chatId}`} items={items} /> : null} />}
  </div>;
});

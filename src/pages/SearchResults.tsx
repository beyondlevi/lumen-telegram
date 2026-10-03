import microphoneFilled from '@wearables-ui-toolkit/icons/svg/microphone__filled.svg';
import {ListItem, Page, VerticalList} from '@wearables-ui-toolkit/mrbd';
import type {RefObject} from 'react';
import {avatarFallback} from '../components/avatarFallback';
import {t} from '../i18n/strings';
import type {NameMatch} from '../search/nameMatch';
import type {SearchTarget} from '../search/searchTargets';

type SearchResultsProps = {
  /** What was heard. */
  text: string;
  matches: NameMatch<SearchTarget>[];
  firstRef: RefObject<HTMLDivElement | null>;
  avatarFor(id: string): string | null;
  onOpen(target: SearchTarget): void;
  onAgain(): void;
};

/** Chats and contacts matching a spoken name, best first, then Search again. */
export function SearchResults({text, matches, firstRef, avatarFor, onOpen, onAgain}: SearchResultsProps) {
  return (
    <Page headerText={t('searchHeader')} headerMetadata={t('searchHeard', {text})} enableSystemBarInset={false}>
      <VerticalList insetForHeader ariaLabel={t('searchResultsLabel', {text})}>
        {matches.map(({item}, index) => {
          const picture = item.inChats ? avatarFor(item.id) : null;
          return (
            <ListItem
              key={item.id}
              ref={index === 0 ? firstRef : undefined}
              title={item.name}
              subtitle={item.inChats ? item.detail ?? undefined : t('searchContact')}
              avatarSrc={picture ?? undefined}
              avatarPrimaryContent={picture ? undefined : avatarFallback(item.name, item.isGroup)}
              avatarAlt={item.name}
              onClick={() => onOpen(item)}
            />
          );
        })}
        <ListItem title={t('searchAgain')} icon={microphoneFilled} onClick={onAgain} />
      </VerticalList>
    </Page>
  );
}

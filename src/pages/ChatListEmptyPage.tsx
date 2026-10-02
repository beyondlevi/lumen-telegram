import {Page, ScrollView, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {t} from '../i18n/strings';

export function ChatListEmptyPage({offline}: {offline: boolean}) {
  return (
    <Page
      headerText={t('chatsHeader')}
      headerMetadata={offline ? t('offlineMeta') : undefined}
      enableSystemBarInset={false}>
      <ScrollView insetForHeader tabIndex={0} ariaLabel={t('emptyLabel')}>
        <div className="content-inset">
          <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
            {t('emptyTitle')}
          </TextView>
          <TextView as="p" textStyle={TextStyle.BODY2}>
            {t('emptyBody')}
          </TextView>
        </div>
      </ScrollView>
    </Page>
  );
}

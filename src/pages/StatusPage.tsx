import {
  Button,
  ButtonRail,
  Page,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';
import type {ConfigField} from '../config/lumenConfig';
import {locale, t, type StringKey} from '../i18n/strings';
import type {TelegramError} from '../telegram/api';
import {useChat, type Phase} from '../ChatProvider';

const FIELD_LABELS: Record<ConfigField, StringKey> = {
  apiId: 'fieldApiId',
  apiHash: 'fieldApiHash',
  session: 'fieldSession',
};

const INVALID_BODIES: Record<ConfigField, StringKey> = {
  apiId: 'errInvalidApiId',
  apiHash: 'errInvalidApiHash',
  session: 'errInvalidSession',
};

const listFormat = () => new Intl.ListFormat(locale, {type: 'conjunction'});

function SetupPage({missing}: {missing: ConfigField[]}) {
  const {reloadConfig} = useChat();
  return (
    <Page headerText={t('setupHeader')} enableSystemBarInset={false}>
      <div className="action-page-shell">
        <ScrollView insetForHeader tabIndex={0} ariaLabel={t('setupLabel')}>
          <div className="content-inset">
            <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
              {t('setupTitle')}
            </TextView>
            <TextView as="p" textStyle={TextStyle.BODY2}>
              {t('setupBody')}
            </TextView>
            <TextView as="p" textStyle={TextStyle.LABEL} textColor={TextColor.SECONDARY}>
              {t('setupMissingLabel')}
            </TextView>
            <TextView as="p" textStyle={TextStyle.META1}>
              {listFormat().format(missing.map(field => t(FIELD_LABELS[field])))}
            </TextView>
          </div>
        </ScrollView>
        <div className="action-dock">
          <ButtonRail>
            <Button title={t('setupCheckAgain')} onClick={reloadConfig} />
          </ButtonRail>
        </div>
      </div>
    </Page>
  );
}

function ConnectingPage() {
  return (
    <Page headerText={t('loadingHeader')} headerIsLoading enableSystemBarInset={false}>
      <ScrollView insetForHeader ariaLabel={t('connectingLabel')}>
        <div className="content-inset" role="status" aria-label={t('connectingLabel')} />
      </ScrollView>
    </Page>
  );
}

function errorCopy(error: TelegramError | null, field: ConfigField | null): [string, string] {
  if (error == null) {
    const target = field ?? 'session';
    return [t('errInvalidTitle', {field: t(FIELD_LABELS[target])}), t(INVALID_BODIES[target])];
  }
  switch (error.kind) {
    case 'network':
      return [t('errNetworkTitle'), t('errNetworkBody')];
    case 'auth':
      return [t('errAuthTitle'), t('errAuthBody')];
    case 'flood':
      return [t('errFloodTitle'), t('errFloodBody', {seconds: error.waitSeconds ?? 60})];
    default:
      return [t('errServerTitle'), t('errServerBody')];
  }
}

function ErrorPage({error, field = null}: {error: TelegramError | null; field?: ConfigField | null}) {
  const {retry} = useChat();
  const [title, body] = errorCopy(error, field);
  return (
    <Page headerText={t('errorHeader')} enableSystemBarInset={false}>
      <div className="action-page-shell">
        <ScrollView insetForHeader tabIndex={0} ariaLabel={t('errorLabel')}>
          <div className="content-inset" role="alert">
            <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
              {title}
            </TextView>
            <TextView as="p" textStyle={TextStyle.BODY2}>
              {body}
            </TextView>
            {error?.code ? (
              <>
                <TextView as="p" textStyle={TextStyle.LABEL} textColor={TextColor.SECONDARY}>
                  {t('errorDetailLabel')}
                </TextView>
                <TextView as="p" textStyle={TextStyle.META1}>
                  {error.code}
                </TextView>
              </>
            ) : null}
          </div>
        </ScrollView>
        {error != null ? (
          <div className="action-dock">
            <ButtonRail>
              <Button title={t('retry')} onClick={retry} />
            </ButtonRail>
          </div>
        ) : null}
      </div>
    </Page>
  );
}

/** Full-screen state shown instead of the chat routes until the connection is ready. */
export function StatusPage({phase}: {phase: Exclude<Phase, {kind: 'ready'}>}) {
  switch (phase.kind) {
    case 'setup':
      return <SetupPage missing={phase.missing} />;
    case 'connecting':
      return <ConnectingPage />;
    case 'invalid-config':
      return <ErrorPage error={null} field={phase.field} />;
    case 'error':
      return <ErrorPage error={phase.error} />;
  }
}

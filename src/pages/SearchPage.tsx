import microphoneFilled from '@wearables-ui-toolkit/icons/svg/microphone__filled.svg';
import {
  Button,
  ButtonRail,
  IndeterminateLoader,
  IndeterminateLoaderSize,
  Page,
  ProgressIndicator,
  ProgressIndicatorSize,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
  type ButtonHandle,
} from '@wearables-ui-toolkit/mrbd';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {meterLevel} from '../audio/lumenAudio';
import {t} from '../i18n/strings';
import {rankByName, type NameMatch} from '../search/nameMatch';
import {searchCandidates, type SearchTarget} from '../search/searchTargets';
import {useVoiceInput} from '../search/useVoiceInput';
import type {VoiceErrorCode} from '../search/voiceInput';
import {useChat} from '../ChatProvider';
import {chatPath} from './ChatListPage';
import {SearchResults} from './SearchResults';
import {StatusPage} from './StatusPage';

export const SEARCH_PATH = '/search';

/** What demo mode "hears": a demo contact's name with one letter wrong. */
export const DEMO_SEARCH_PHRASE = 'Maia';

type SearchState =
  | {kind: 'listening'; partial: string; level: number | null}
  | {kind: 'recognizing'; partial: string}
  | {kind: 'searching'; text: string}
  | {kind: 'results'; text: string; matches: NameMatch<SearchTarget>[]}
  | {kind: 'no-match'; text: string}
  | {kind: 'no-speech'}
  | {kind: 'failed'; message: string}
  | {kind: 'unavailable'};

function failureMessage(code: VoiceErrorCode, message?: string): string {
  switch (code) {
    case 'busy':
      return t('audioBusy');
    case 'no-phone':
      return t('audioNoPhone');
    case 'network':
      return t('searchNetwork');
    default:
      return t('audioOther', {message: message || code});
  }
}

/** Voice search: listens for a name, then lists the chats and contacts that match it. */
export function SearchPage() {
  const {phase} = useChat();
  if (phase.kind !== 'ready') {
    return <StatusPage phase={phase} />;
  }
  return <VoiceSearch />;
}

function VoiceSearch() {
  const {demo, searchTargets, avatarFor} = useChat();
  const navigate = useNavigate();
  const {input, notWorking} = useVoiceInput(demo ? DEMO_SEARCH_PHRASE : null);
  const [state, setState] = useState<SearchState>({kind: 'listening', partial: '', level: null});
  const [attempt, setAttempt] = useState(0);
  const listeningRef = useRef<{finish(): void} | null>(null);
  const actionRef = useRef<ButtonHandle>(null);
  const firstResultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (input == null) {
      setState({kind: 'unavailable'});
      return;
    }
    let alive = true;
    setState({kind: 'listening', partial: '', level: null});
    // Chats and contacts load while the wearer speaks.
    const targets = searchTargets();
    const listening = input.listen(
      {
        onPartial: partial => alive && setState(current => (current.kind === 'listening' || current.kind === 'recognizing' ? {...current, partial} : current)),
        onLevel: level => alive && setState(current => (current.kind === 'listening' ? {...current, level} : current)),
        onRecognizing: () => alive && setState(current => ({kind: 'recognizing', partial: current.kind === 'listening' ? current.partial : ''})),
        onResult: text => {
          if (!alive) {
            return;
          }
          setState({kind: 'searching', text});
          void targets.then(list => {
            if (!alive) {
              return;
            }
            const matches = rankByName(text, searchCandidates(list));
            setState(matches.length > 0 ? {kind: 'results', text, matches} : {kind: 'no-match', text});
          });
        },
        onError: (code, message) => {
          if (!alive) {
            return;
          }
          if (code === 'unavailable') {
            // Another recognizer (or none) takes over; this effect runs again.
            notWorking(input.kind);
          } else if (code === 'no-speech') {
            setState({kind: 'no-speech'});
          } else {
            setState({kind: 'failed', message: failureMessage(code, message)});
          }
        },
      },
      navigator.language || 'en',
    );
    listeningRef.current = listening;
    return () => {
      alive = false;
      listeningRef.current = null;
      listening.cancel();
    };
  }, [attempt, input, notWorking, searchTargets]);

  const showsResults = state.kind === 'results';
  // The screen's main control changes with the state: the action button, or
  // the best result once there are results.
  useEffect(() => {
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        const target = showsResults ? firstResultRef.current : actionRef.current?.getElement();
        target?.focus({preventScroll: true});
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showsResults, attempt]);

  const again = useCallback(() => setAttempt(count => count + 1), []);
  const finish = useCallback(() => listeningRef.current?.finish(), []);
  const back = useCallback(() => navigate(-1), [navigate]);
  const open = useCallback(
    (target: SearchTarget) => navigate(chatPath(target.id), {replace: true}),
    [navigate],
  );

  if (state.kind === 'results') {
    return <SearchResults text={state.text} matches={state.matches} firstRef={firstResultRef} avatarFor={avatarFor} onOpen={open} onAgain={again} />;
  }

  const listening = state.kind === 'listening';
  const working = state.kind === 'recognizing' || state.kind === 'searching';
  const heard =
    state.kind === 'listening' || state.kind === 'recognizing'
      ? state.partial
      : state.kind === 'searching' || state.kind === 'no-match'
        ? state.text
        : '';
  const title =
    state.kind === 'listening'
      ? t('searchListening')
      : state.kind === 'recognizing'
        ? t('searchRecognizing')
        : state.kind === 'searching'
          ? t('searchSearching')
          : state.kind === 'no-match'
            ? t('searchNoMatchTitle', {text: state.text})
            : state.kind === 'no-speech'
              ? t('searchNoSpeechTitle')
              : state.kind === 'unavailable'
                ? t('searchUnavailableTitle')
                : t('searchFailedTitle');
  const body =
    state.kind === 'listening' && !heard
      ? t('searchSayName')
      : state.kind === 'no-match'
        ? t('searchNoMatchBody')
        : state.kind === 'no-speech'
          ? t('searchNoSpeechBody')
          : state.kind === 'unavailable'
            ? t('searchUnavailableBody')
            : state.kind === 'failed'
              ? state.message
              : null;

  return (
    <Page headerText={t('searchHeader')} enableSystemBarInset={false}>
      <div className="action-page-shell">
        <ScrollView insetForHeader ariaLabel={t('searchLabel')}>
          <div className="content-inset record-panel" role="status">
            <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
              {title}
            </TextView>
            {heard && state.kind !== 'no-match' ? (
              <TextView as="p" className="search-heard" textStyle={TextStyle.BODY2}>
                {t('searchHeard', {text: heard})}
              </TextView>
            ) : null}
            {listening && state.level != null ? (
              <ProgressIndicator
                size={ProgressIndicatorSize.DEFAULT}
                value={meterLevel(state.level)}
                maximumValue={1}
                isActive
                announceUpdatesForAccessibility={false}
                aria-label={t('recordingLevel')}
              />
            ) : null}
            {listening || working ? <IndeterminateLoader size={IndeterminateLoaderSize.SMALL} /> : null}
            {body ? (
              <TextView as="p" textStyle={TextStyle.META1} textColor={TextColor.SECONDARY}>
                {body}
              </TextView>
            ) : null}
          </div>
        </ScrollView>
        <div className="action-dock">
          <ButtonRail>
            {/* One Button whose command follows the state, so focus stays put. */}
            <Button
              ref={actionRef}
              title={listening || working ? t('searchDone') : state.kind === 'unavailable' ? t('searchBack') : t('retry')}
              icon={listening || working || state.kind === 'unavailable' ? undefined : microphoneFilled}
              onClick={listening ? finish : working ? undefined : state.kind === 'unavailable' ? back : again}
            />
          </ButtonRail>
        </div>
      </div>
    </Page>
  );
}

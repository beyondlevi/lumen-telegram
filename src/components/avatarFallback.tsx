import circleUserFilled from '@wearables-ui-toolkit/icons/svg/circleuser__filled.svg';
import circleUserStackFilled from '@wearables-ui-toolkit/icons/svg/circleuserstack__filled.svg';
import {IconImage} from '@wearables-ui-toolkit/mrbd';
import type {ReactNode} from 'react';
import {initials} from '../format';

/** Avatar content when there is no picture: initials, or a person/group icon for an unnamed chat. */
export function avatarFallback(name: string | null | undefined, isGroup: boolean): ReactNode {
  return name ? initials(name) : <IconImage source={isGroup ? circleUserStackFilled : circleUserFilled} />;
}

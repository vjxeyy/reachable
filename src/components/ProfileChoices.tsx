import { PROFILES } from '../core/profiles'
import { PROFILE_IDS, type ProfileId } from '../core/types'
import { CheckIcon, ProfileIcon } from './icons'

interface Props {
  profiles: readonly ProfileId[]
  onChange: (profiles: ProfileId[]) => void
}

/** The profile check boxes. None is ticked at first, and any number can be ticked. */
export function ProfileChoices({ profiles, onChange }: Props) {
  return (
    <fieldset className="profiles">
      <legend>Profile</legend>
      {PROFILE_IDS.map((id) => {
        const checked = profiles.includes(id)
        return (
          <label key={id} className={`profile-option${checked ? ' is-active' : ''}`}>
            <input
              type="checkbox"
              name="profile"
              value={id}
              checked={checked}
              onChange={() => onChange(PROFILE_IDS.filter((p) => (p === id ? !checked : profiles.includes(p))))}
            />
            <span className="profile-box" aria-hidden="true">
              {checked && <CheckIcon size={12} />}
            </span>
            <ProfileIcon profile={id} />
            <span>{PROFILES[id].name}</span>
          </label>
        )
      })}
    </fieldset>
  )
}

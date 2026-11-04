// Which way of using REACHABLE the person chose on the welcome screen. Only "map" is remembered:
// the voice guide needs a tap each visit before the browser lets it speak, so it is always offered first.

const KEY = 'reachable.experience'

export function getExperience(): 'map' | null {
  try {
    return localStorage.getItem(KEY) === 'map' ? 'map' : null
  } catch {
    return null
  }
}

/** Remembers the choice (when the browser allows it) and tells the page to look again. */
export function setExperience(choice: 'map' | null): void {
  try {
    if (choice) localStorage.setItem(KEY, choice)
    else localStorage.removeItem(KEY)
  } catch {
    // Without storage the welcome screen simply shows again next time.
  }
  window.dispatchEvent(new Event('hashchange'))
}

import { useEffect } from 'react'

/** Sets the browser tab title. Pass undefined to leave it to a child page. */
export function usePageTitle(title) {
  useEffect(() => {
    if (title === undefined) return
    document.title = title ? `${title} · Yehulu` : 'Yehulu'
  }, [title])
}

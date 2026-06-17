// In-app navigation to/from the full-screen Settings overlay. Uses the hash so
// AppRouter (which listens to `hashchange`) re-renders, and it survives reloads.
export const openSettings = () => { window.location.hash = '#/settings'; };
export const closeSettings = () => { window.location.hash = '#/'; };
